const fs = require("fs");
const path = require("path");
const { applyAuth } = require("./auth_handlers");
const { SourceStateStore } = require("./source_state_store");

const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

function readJson(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(text);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function replaceTemplate(value, params) {
  return String(value || "").replace(/\{(\w+)\}/g, (_, key) => encodeURIComponent(params[key] || ""));
}

function withQuery(url, params) {
  const target = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && String(value) !== "") {
      target.searchParams.set(key, String(value));
    }
  }
  return target.toString();
}

function resolveConfigPath(value) {
  if (!value) return "";
  const expanded = String(value)
    .replace(/^~(?=$|[\\/])/, osHome())
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || "")
    .replace(/\$HOME/g, process.env.HOME || "");
  return path.resolve(expanded);
}

function osHome() {
  return process.env.USERPROFILE || process.env.HOME || process.cwd();
}

function getByPath(input, selector) {
  if (!selector) return undefined;
  return String(selector)
    .split(".")
    .filter(Boolean)
    .reduce((value, key) => {
      if (value === undefined || value === null) return undefined;
      if (Array.isArray(value) && /^\d+$/.test(key)) return value[Number(key)];
      return value[key];
    }, input);
}

function normalizeRecord(raw, source, mapping = {}) {
  const title = getByPath(raw, mapping.titlePath) || raw.title || raw.name || raw.companyName || "";
  const summary = getByPath(raw, mapping.summaryPath) || raw.summary || raw.description || raw.content || "";
  const url = getByPath(raw, mapping.urlPath) || raw.url || raw.link || source.endpoint || source.officialUrl || "";
  const publishedAt = getByPath(raw, mapping.publishedAtPath) || raw.publishedAt || raw.date || raw.time || "";
  const confidence = Number(getByPath(raw, mapping.confidencePath) || raw.confidence || source.defaultConfidence || 0.5);
  const relatedSubjects = getByPath(raw, mapping.relatedSubjectsPath) || raw.relatedSubjects || raw.entities || raw.relations || [];
  const value = getByPath(raw, mapping.valuePath) || raw.value || "";
  const category = getByPath(raw, mapping.categoryPath) || raw.category || source.category || "";
  return {
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type || "http-api",
    admissionClass: source.admissionClass || "public",
    dataCategory: source.dataCategory || category || "",
    title: String(title || ""),
    summary: typeof summary === "object" ? JSON.stringify(summary) : String(summary || value || ""),
    url: String(url || ""),
    publishedAt: String(publishedAt || ""),
    confidence: Number.isFinite(confidence) ? confidence : 0.5,
    relatedSubjects: asArray(relatedSubjects).map((item) => {
      if (typeof item === "string") return { name: item, relation: "mentioned", confidence: 0.5 };
      return {
        name: String(item.name || item.title || item.companyName || ""),
        relation: String(item.relation || item.type || "mentioned"),
        confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : 0.5
      };
    }).filter((item) => item.name),
    raw
  };
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html) {
  const match = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match ? match[1] : "");
}

function normalizeHtmlPayload(html, source, requestUrl) {
  const text = stripHtml(html).slice(0, source.summaryMaxChars || 2000);
  return normalizePayload({
    records: [{
      title: titleFromHtml(html) || source.name,
      summary: text,
      url: requestUrl
    }]
  }, { ...source, endpoint: requestUrl });
}

function normalizePayload(payload, source) {
  const mapping = source.resultMapping || {};
  const recordsValue = getByPath(payload, mapping.recordsPath) || payload.records || payload.items || payload.data || payload.results || payload;
  const records = Array.isArray(recordsValue) ? recordsValue : [recordsValue];
  return {
    schemaVersion: "subject-intelligence/v0",
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type || "http-api",
    fetchedAt: new Date().toISOString(),
    provenance: {
      endpoint: source.endpoint || "",
      delivery: source.delivery || "http",
      requiresCredential: Boolean(source.requiresCredential),
      publicAccess: source.publicAccess !== false
    },
    records: records.filter(Boolean).map((item) => normalizeRecord(item, source, mapping))
  };
}

function sourceFromTarget(target) {
  if (!target || !target.id) return null;
  if (target.strategy === "manual-judicial") {
    return {
      id: target.id,
      name: target.name,
      type: "web-manual",
      delivery: "official-web",
      enabled: true,
      publicAccess: true,
      requiresCredential: true,
      endpoint: target.officialUrl,
      healthUrl: target.officialUrl,
      tags: ["judicial", "assisted"]
    };
  }
  if (target.strategy === "baidu-page") {
    return {
      id: target.id,
      name: target.name,
      type: "search-page",
      delivery: "search-web",
      enabled: true,
      publicAccess: true,
      requiresCredential: false,
      endpoint: "https://www.baidu.com/s",
      queryParam: "wd",
      tags: ["search"]
    };
  }
  return {
    id: target.id,
    name: target.name,
    type: "web",
    delivery: "official-web",
    enabled: true,
    publicAccess: true,
    requiresCredential: false,
    endpoint: target.officialUrl,
    healthUrl: target.officialUrl,
    queryParam: "q",
    tags: ["official", "public"]
  };
}

function loadExternalDataSourcesFromEnv() {
  const envValue = process.env.POST_LOAN_DATA_SOURCES || "";
  if (!envValue) return [];
  const configPath = resolveConfigPath(envValue);
  if (configPath && fs.existsSync(configPath)) return asArray(readJson(configPath).dataSources);
  try {
    return asArray(JSON.parse(envValue).dataSources || JSON.parse(envValue));
  } catch {
    return [];
  }
}

function normalizeSource(source) {
  const normalized = {
    type: "http-api",
    enabled: true,
    publicAccess: true,
    requiresCredential: false,
    method: "GET",
    queryParam: "q",
    queryParams: {},
    timeoutMs: DEFAULT_TIMEOUT_MS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
    headers: {},
    resultMapping: {},
    tags: [],
    admissionClass: "public",
    defaultEnabled: true,
    challengePolicy: "auto",
    ...source
  };
  if (!normalized.healthUrl && normalized.endpoint) normalized.healthUrl = normalized.endpoint;
  return normalized;
}

function loadConfiguredSources({ configFile, config, extraConfigFile } = {}) {
  const base = config || readJson(configFile);
  const fromDataSources = asArray(base.dataSources);
  const fromTargets = asArray(base.targets).map(sourceFromTarget).filter(Boolean);
  const extra = extraConfigFile && fs.existsSync(extraConfigFile) ? asArray(readJson(extraConfigFile).dataSources) : [];
  const envExtra = loadExternalDataSourcesFromEnv();
  const merged = [...fromTargets, ...fromDataSources, ...extra, ...envExtra].map(normalizeSource);
  const byId = new Map();
  for (const source of merged) byId.set(source.id, { ...(byId.get(source.id) || {}), ...source });
  return [...byId.values()];
}

class DataSourceRegistry {
  constructor({ configFile, config, extraConfigFile = "", audit, stateStore, fetchImpl = global.fetch } = {}) {
    if (!fetchImpl) throw new Error("fetch is required; use Node 18+ or pass fetchImpl");
    this.audit = audit;
    this.fetchImpl = fetchImpl;
    this.sources = loadConfiguredSources({ configFile, config, extraConfigFile });
    this.stateStore = stateStore || new SourceStateStore({ audit });
  }

  list({ includeDisabled = false } = {}) {
    return this.sources.filter((source) => includeDisabled || source.enabled !== false);
  }

  get(sourceId) {
    return this.sources.find((source) => source.id === sourceId) || null;
  }

  available({ includeCredentialed = false } = {}) {
    return this.list()
      .filter((source) => includeCredentialed || !source.requiresCredential)
      .filter((source) => !this.stateStore.isCoolingDown(`datasource:${source.id}`));
  }

  async healthCheck(source) {
    const sourceId = `datasource:${source.id}`;
    if (source.enabled === false) {
      return { sourceId: source.id, ok: false, status: "disabled", reason: "source_disabled" };
    }
    if (!source.healthUrl) {
      return { sourceId: source.id, ok: true, status: "unknown", reason: "no_health_url" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeoutMs || DEFAULT_TIMEOUT_MS);
    const started = Date.now();
    try {
      const auth = applyAuth({
        url: source.healthUrl,
        method: source.healthMethod || "GET",
        headers: source.headers || {}
      }, source.auth);
      if (!auth.ok) {
        const result = { sourceId: source.id, ok: false, status: "auth_missing", reason: auth.reason, url: source.healthUrl };
        this.audit?.record("datasource_health_auth_missing", result);
        return result;
      }
      const response = await this.fetchImpl(auth.request.url, {
        method: source.healthMethod || "GET",
        headers: auth.request.headers || {},
        signal: controller.signal
      });
      const latencyMs = Date.now() - started;
      const ok = response.status >= 200 && response.status < 400;
      const result = { sourceId: source.id, ok, status: response.status, latencyMs, url: source.healthUrl };
      if (ok) {
        this.stateStore.markSuccess(sourceId, result);
      } else {
        this.stateStore.markCooldown(sourceId, {
          reason: `http_${response.status}`,
          cooldownMs: source.cooldownMs || DEFAULT_COOLDOWN_MS,
          payload: result
        });
      }
      this.audit?.record("datasource_health_checked", result);
      return result;
    } catch (error) {
      const result = {
        sourceId: source.id,
        ok: false,
        status: "error",
        reason: String(error.message || error),
        url: source.healthUrl
      };
      this.stateStore.markCooldown(sourceId, {
        reason: result.reason,
        cooldownMs: source.cooldownMs || DEFAULT_COOLDOWN_MS,
        payload: result
      });
      this.audit?.record("datasource_health_failed", result);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async healthCheckAll() {
    const results = [];
    for (const source of this.list()) {
      results.push(await this.healthCheck(source));
    }
    return results;
  }

  async healthCheckAvailable({ includeCredentialed = false } = {}) {
    const results = [];
    for (const source of this.available({ includeCredentialed })) {
      results.push(await this.healthCheck(source));
    }
    return results;
  }

  buildQueryRequest(source, query) {
    if (!source.endpoint) throw new Error(`source ${source.id} has no endpoint`);
    const params = typeof query === "string" ? { q: query, companyName: query, keyword: query } : { ...query };
    let url = replaceTemplate(source.endpoint, params);
    if (!/\{\w+\}/.test(source.endpoint) && source.method !== "POST") {
      url = withQuery(url, {
        ...(source.queryParams || {}),
        [source.queryParam || "q"]: params.companyName || params.q || params.keyword
      });
    }
    const request = {
      url,
      method: source.method || "GET",
      headers: { ...(source.headers || {}) }
    };
    if (request.method === "POST") {
      request.headers["content-type"] = request.headers["content-type"] || "application/json";
      request.body = JSON.stringify({ query: params.q || params.companyName || params.keyword, ...params });
    }
    if (source.userAgent) request.headers["user-agent"] = source.userAgent;
    return request;
  }

  async querySource(source, query) {
    const sourceId = `datasource:${source.id}`;
    if (this.stateStore.isCoolingDown(sourceId)) {
      return { ok: false, sourceId: source.id, skipped: true, reason: "cooldown" };
    }
    const request = this.buildQueryRequest(source, query);
    const auth = applyAuth(request, source.auth);
    if (!auth.ok) {
      const result = { ok: false, sourceId: source.id, status: "auth_missing", reason: auth.reason, requestUrl: request.url };
      this.audit?.record("datasource_query_auth_missing", result);
      return result;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), source.timeoutMs || DEFAULT_TIMEOUT_MS);
    const started = Date.now();
    try {
      const response = await this.fetchImpl(auth.request.url, {
        method: auth.request.method,
        headers: auth.request.headers,
        body: auth.request.body,
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();
      const normalized = contentType.includes("json")
        ? normalizePayload(JSON.parse(text || "{}"), { ...source, endpoint: auth.request.url })
        : normalizeHtmlPayload(text, source, auth.request.url);
      const result = {
        ok: response.status >= 200 && response.status < 400,
        sourceId: source.id,
        status: response.status,
        latencyMs: Date.now() - started,
        requestUrl: auth.request.url,
        normalized
      };
      if (result.ok) {
        this.stateStore.markSuccess(sourceId, { statusCode: response.status, records: normalized.records.length });
      } else {
        this.stateStore.markCooldown(sourceId, {
          reason: `http_${response.status}`,
          cooldownMs: source.cooldownMs || DEFAULT_COOLDOWN_MS,
          payload: { statusCode: response.status, requestUrl: auth.request.url }
        });
      }
      this.audit?.record("datasource_query_completed", { sourceId: source.id, ok: result.ok, status: response.status, records: normalized.records.length });
      return result;
    } catch (error) {
      const result = { ok: false, sourceId: source.id, status: "error", reason: String(error.message || error), requestUrl: auth.request.url };
      this.stateStore.markCooldown(sourceId, {
        reason: result.reason,
        cooldownMs: source.cooldownMs || DEFAULT_COOLDOWN_MS,
        payload: result
      });
      this.audit?.record("datasource_query_failed", result);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }

  async query(query, { includeCredentialed = false } = {}) {
    const results = [];
    for (const source of this.available({ includeCredentialed })) {
      if (!["http-api", "public-api", "search-api", "osint-api", "public-web", "web-search"].includes(source.type)) continue;
      results.push(await this.querySource(source, query));
    }
    return results;
  }
}

module.exports = {
  DataSourceRegistry,
  loadConfiguredSources,
  normalizePayload,
  normalizeRecord,
  stripHtml
};

