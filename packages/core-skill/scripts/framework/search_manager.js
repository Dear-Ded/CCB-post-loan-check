const { CircuitBreaker, ChallengeKind } = require("./challenge_policy");
const { ChallengeEngine } = require("./challenge_engine");
const { SourceStateStore } = require("./source_state_store");

const SEARCH_ENGINES = [
  {
    id: "baidu",
    name: "百度搜索",
    url: (query, pageNo) => `https://www.baidu.com/s?wd=${encodeURIComponent(query)}&pn=${(pageNo - 1) * 10}`,
    validUrl: (url) => url.includes("baidu.com/s")
  },
  {
    id: "so360",
    name: "360搜索",
    url: (query, pageNo) => `https://www.so.com/s?q=${encodeURIComponent(query)}&pn=${pageNo}`,
    validUrl: (url) => url.includes("so.com/s")
  },
  {
    id: "sogou",
    name: "搜狗搜索",
    url: (query, pageNo) => `https://www.sogou.com/web?query=${encodeURIComponent(query)}&page=${pageNo}`,
    validUrl: (url) => url.includes("sogou.com/web")
  },
  {
    id: "bing",
    name: "Bing搜索",
    url: (query, pageNo) => `https://www.bing.com/search?q=${encodeURIComponent(query)}&first=${(pageNo - 1) * 10 + 1}`,
    validUrl: (url) => url.includes("bing.com/search")
  }
];

function companyTerms(company) {
  return company
    .replace(/[（）()]/g, " ")
    .replace(/有限公司|股份|集团|分行|公司/g, " ")
    .split(/\s+/)
    .flatMap((part) => part.length > 4 ? [part, part.slice(0, 2), part.slice(2, 4)] : [part])
    .filter((part) => part && part.length >= 2);
}

function subjectMatched(company, text) {
  if (text.includes(company)) return true;
  const terms = companyTerms(company);
  const hits = terms.filter((term) => text.includes(term)).length;
  return hits >= Math.min(2, terms.length);
}

function cooldownForChallenge(kind, baseMs) {
  if (kind === ChallengeKind.RATE_LIMIT) return Math.max(baseMs, 20 * 60 * 1000);
  if (kind === ChallengeKind.CAPTCHA) return Math.max(baseMs, 15 * 60 * 1000);
  if (kind === ChallengeKind.SECURITY_GATE) return Math.max(baseMs, 10 * 60 * 1000);
  return baseMs;
}

class SearchManager {
  constructor({ audit, cooldownMs = 8 * 60 * 1000, stateStore, challengeEngine } = {}) {
    this.audit = audit;
    this.cooldownMs = cooldownMs;
    this.breaker = new CircuitBreaker({ cooldownMs, threshold: 1 });
    this.stateStore = stateStore || new SourceStateStore({ audit });
    this.challengeEngine = challengeEngine || new ChallengeEngine({ audit });
  }

  async capture({ page, company, captureCompleteScroll, add }) {
    const query = company;
    const context = page.context();
    for (const engine of SEARCH_ENGINES) {
      const sourceId = `search:${engine.id}`;
      if (this.breaker.isOpen(engine.id) || this.stateStore.isCoolingDown(sourceId)) {
        const state = this.stateStore.get(sourceId);
        this.audit?.record("search_engine_skipped_cooldown", { engine: engine.id, company, state });
        continue;
      }

      const searchPage = await context.newPage();
      let captured = 0;
      let blocked = false;
      const validatedPages = [];
      try {
        for (const pageNo of [1, 2, 3]) {
          try {
            await searchPage.goto(engine.url(query, pageNo), { waitUntil: "domcontentloaded", timeout: 15000 });
            await searchPage.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
            await searchPage.waitForTimeout(600);
          } catch (error) {
            const message = String(error.message || error);
            this.audit?.record("search_page_load_failed", { engine: engine.id, company, pageNo, error: message });
            this.stateStore.markCooldown(sourceId, {
              reason: "page_load_failed",
              cooldownMs: Math.max(this.cooldownMs, 5 * 60 * 1000),
              payload: { pageNo, error: message }
            });
            blocked = true;
            break;
          }

          const snapshot = await this.challengeEngine.inspectPage(searchPage, {
            sourceId,
            sourceType: "search-engine",
            sourceName: engine.name,
            mode: "blocked"
          });
          const text = snapshot.text;
          const challenge = snapshot.challenge;
          if (challenge.kind !== "none") {
            const cooldownMs = cooldownForChallenge(challenge.kind, this.cooldownMs);
            this.breaker.trip(engine.id, challenge.reason);
            this.audit?.record("search_challenge_detected", { engine: engine.id, company, pageNo, url: snapshot.url, title: snapshot.title, ...challenge });
            this.stateStore.markCooldown(sourceId, {
              reason: challenge.reason,
              cooldownMs,
              payload: { pageNo, kind: challenge.kind, url: snapshot.url, title: snapshot.title }
            });
            blocked = true;
            break;
          }

          if (!engine.validUrl(searchPage.url()) || !subjectMatched(company, text)) {
            this.audit?.record("search_subject_mismatch", { engine: engine.id, company, pageNo, url: searchPage.url() });
            if (!engine.validUrl(searchPage.url())) {
              this.stateStore.markCooldown(sourceId, {
                reason: "invalid_search_url",
                cooldownMs: Math.max(this.cooldownMs, 5 * 60 * 1000),
                payload: { pageNo, url: searchPage.url() }
              });
            }
            blocked = true;
            break;
          }

          validatedPages.push({ pageNo, url: searchPage.url() });
        }

        if (!blocked && validatedPages.length === 3) {
          for (const item of validatedPages) {
            await searchPage.goto(item.url, { waitUntil: "domcontentloaded", timeout: 15000 });
            await searchPage.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
            await searchPage.waitForTimeout(600);
            const snapshot = await this.challengeEngine.inspectPage(searchPage, {
              sourceId,
              sourceType: "search-engine",
              sourceName: engine.name,
              mode: "blocked"
            });
            if (snapshot.challenge.kind !== "none" || !engine.validUrl(searchPage.url())) {
              blocked = true;
              this.audit?.record("search_capture_aborted_after_recheck", {
                engine: engine.id,
                company,
                pageNo: item.pageNo,
                url: searchPage.url(),
                challenge: snapshot.challenge
              });
              break;
            }
            await captureCompleteScroll(searchPage, add, `${engine.name}第${item.pageNo}页`);
            captured += 1;
          }
        }

        if (!blocked && captured === 3) {
          this.breaker.reset(engine.id);
          this.stateStore.markSuccess(sourceId, { engine: engine.id, pages: captured });
          this.audit?.record("search_engine_completed", { engine: engine.id, company, pages: captured });
          return { ok: true, engine: engine.id, pages: captured };
        }
      } finally {
        await searchPage.close().catch(() => {});
      }
    }

    this.audit?.record("search_all_engines_failed", { company });
    return { ok: false, engine: "", pages: 0 };
  }
}

module.exports = { SEARCH_ENGINES, SearchManager, companyTerms, subjectMatched };
