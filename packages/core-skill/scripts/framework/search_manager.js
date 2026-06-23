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

function searchVariants(company) {
  const trimmed = String(company || "").trim();
  return trimmed ? [trimmed] : [];
}

function cooldownForChallenge(kind, baseMs) {
  if (kind === ChallengeKind.RATE_LIMIT) return Math.max(baseMs, 20 * 60 * 1000);
  if (kind === ChallengeKind.CAPTCHA) return Math.max(baseMs, 15 * 60 * 1000);
  if (kind === ChallengeKind.SECURITY_GATE) return Math.max(baseMs, 10 * 60 * 1000);
  return baseMs;
}

function envFlag(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function envInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

class SearchManager {
  constructor({
    audit,
    cooldownMs = 8 * 60 * 1000,
    stateStore,
    challengeEngine,
    recoveryFirst = envFlag("POST_LOAN_SEARCH_RECOVERY_FIRST", true),
    maxRecoveryAttempts = envInt("POST_LOAN_SEARCH_RECOVERY_ATTEMPTS", 3)
  } = {}) {
    this.audit = audit;
    this.cooldownMs = cooldownMs;
    this.breaker = new CircuitBreaker({ cooldownMs, threshold: 1 });
    this.stateStore = stateStore || new SourceStateStore({ audit });
    this.challengeEngine = challengeEngine || new ChallengeEngine({ audit });
    this.recoveryFirst = recoveryFirst;
    this.maxRecoveryAttempts = Math.max(1, maxRecoveryAttempts);
  }

  async capture({ page, company, captureCompleteScroll, add, discardCaptures }) {
    const context = page.context();
    const variants = searchVariants(company);
    for (const engine of SEARCH_ENGINES) {
      const sourceId = `search:${engine.id}`;
      if (this.breaker.isOpen(engine.id) || this.stateStore.isCoolingDown(sourceId)) {
        const state = this.stateStore.get(sourceId);
        if (!this.recoveryFirst) {
          this.audit?.record("search_engine_skipped_cooldown", { engine: engine.id, company, state });
          continue;
        }
        this.audit?.record("search_engine_cooldown_recovery_attempted", { engine: engine.id, company, state });
      }

      const searchPage = await context.newPage();
      let captured = 0;
      let blocked = false;
      const searchCaptures = [];
      try {
        for (const pageNo of [1, 2, 3]) {
          let pageOk = false;
          let lastError = "";
          for (const variant of variants) {
            for (let recoveryAttempt = 1; recoveryAttempt <= this.maxRecoveryAttempts; recoveryAttempt += 1) {
              try {
                await searchPage.goto(engine.url(variant, pageNo), { waitUntil: "domcontentloaded", timeout: 15000 });
                await searchPage.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
                await searchPage.waitForTimeout(600 + recoveryAttempt * 350);
              } catch (error) {
                lastError = String(error.message || error);
                this.audit?.record("search_page_load_failed", { engine: engine.id, company, pageNo, variant, recoveryAttempt, error: lastError });
                continue;
              }

              const snapshot = await this.challengeEngine.inspectPage(searchPage, {
                sourceId,
                sourceType: "search-engine",
                sourceName: engine.name
              });
              const text = snapshot.text;
              const challenge = snapshot.challenge;
              const validSearchResult = engine.validUrl(searchPage.url()) && subjectMatched(company, text);
              if (challenge.kind !== "none" && !(challenge.kind === ChallengeKind.LOGIN && validSearchResult)) {
                const cooldownMs = cooldownForChallenge(challenge.kind, this.cooldownMs);
                this.audit?.record("search_challenge_detected", {
                  engine: engine.id,
                  company,
                  pageNo,
                  variant,
                  recoveryAttempt,
                  url: snapshot.url,
                  title: snapshot.title,
                  ...challenge
                });
                if (this.recoveryFirst && recoveryAttempt < this.maxRecoveryAttempts) {
                  await searchPage.waitForTimeout(Math.min(8000, 1500 * recoveryAttempt));
                  await searchPage.reload({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
                  continue;
                }
                this.breaker.trip(engine.id, challenge.reason);
                this.stateStore.markCooldown(sourceId, {
                  reason: challenge.reason,
                  cooldownMs,
                  payload: { pageNo, kind: challenge.kind, url: snapshot.url, title: snapshot.title }
                });
                blocked = true;
                lastError = challenge.reason;
                break;
              }

              if (!validSearchResult) {
                this.audit?.record("search_subject_mismatch", { engine: engine.id, company, pageNo, variant, recoveryAttempt, url: searchPage.url() });
                lastError = "subject_mismatch";
                continue;
              }

              const newCaptures = await captureCompleteScroll(searchPage, add, `${engine.name}第${pageNo}页`);
              if (Array.isArray(newCaptures)) searchCaptures.push(...newCaptures);
              captured += 1;
              pageOk = true;
              break;
            }
            if (blocked || pageOk) break;
          }
          if (blocked) {
            break;
          }

          if (!pageOk) {
            if (!blocked) {
              this.audit?.record("search_page_unresolved", { engine: engine.id, company, pageNo, error: lastError });
            }
            blocked = true;
            break;
          }
        }

        if (!blocked && captured === 3) {
          this.breaker.reset(engine.id);
          this.stateStore.markSuccess(sourceId, { engine: engine.id, pages: captured });
          this.audit?.record("search_engine_completed", { engine: engine.id, company, pages: captured });
          return { ok: true, engine: engine.id, pages: captured };
        }
        if (blocked && searchCaptures.length && typeof discardCaptures === "function") {
          discardCaptures(searchCaptures);
          this.audit?.record("search_partial_captures_discarded", { engine: engine.id, company, count: searchCaptures.length });
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
