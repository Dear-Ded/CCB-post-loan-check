const fs = require("fs");
const path = require("path");

function readJson(file) {
  if (!file || !fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function providerHeaders() {
  const headers = { accept: "application/json" };
  const token = process.env.POST_LOAN_JUDICIAL_PROVIDER_TOKEN || "";
  if (token) headers.authorization = `Bearer ${token}`;
  const extra = process.env.POST_LOAN_JUDICIAL_PROVIDER_HEADERS || "";
  if (extra) {
    Object.assign(headers, JSON.parse(extra));
  }
  return headers;
}

function recordsFromPayload(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  return payload.records || payload.items || payload.data || [];
}

async function fetchAuthorizedRecords(company, { endpoint = process.env.POST_LOAN_JUDICIAL_PROVIDER_URL, audit } = {}) {
  if (!endpoint) return { records: [], source: "" };
  const url = new URL(endpoint);
  if (!url.searchParams.has("company") && !url.searchParams.has("subject")) {
    url.searchParams.set("company", company);
  }
  const started = Date.now();
  const response = await fetch(url, {
    headers: providerHeaders(),
    signal: AbortSignal.timeout(Number(process.env.POST_LOAN_JUDICIAL_PROVIDER_TIMEOUT_MS || 20000))
  });
  const text = await response.text();
  if (!response.ok) {
    audit?.record("authorized_judicial_provider_http_failed", {
      url: url.toString(),
      status: response.status,
      bodySample: text.slice(0, 300)
    });
    throw new Error(`authorized judicial provider returned HTTP ${response.status}`);
  }
  const payload = JSON.parse(text.replace(/^\uFEFF/, ""));
  const records = recordsFromPayload(payload);
  audit?.record("authorized_judicial_provider_http_completed", {
    url: url.toString(),
    records: records.length,
    latencyMs: Date.now() - started
  });
  return { records, source: url.toString() };
}

function normalizeRecords(company, records, source) {
  const normalized = [];
  for (const item of records || []) {
    if (!item) continue;
    const subject = String(item.company || item.subject || item.name || "");
    if (subject && subject !== company) continue;
    normalized.push({
      company,
      type: item.type || item.kind || item.category || "",
      category: item.category || item.dataCategory || "",
      title: item.title || item.caseTitle || item.name || "",
      summary: item.summary || item.result || item.status || item.description || "",
      url: item.url || item.sourceUrl || "",
      person: item.person || item.personName || "",
      providerSource: item.providerSource || source || ""
    });
  }
  return normalized;
}

async function loadAuthorizedJudicialData(company, {
  file = process.env.POST_LOAN_JUDICIAL_PROVIDER_FILE,
  dataSourceResults = [],
  audit
} = {}) {
  const records = [];
  const fromFile = readJson(file);
  if (fromFile) {
    records.push(...normalizeRecords(company, recordsFromPayload(fromFile), file || "local-authorized-file"));
  }

  const remote = await fetchAuthorizedRecords(company, { audit }).catch((error) => {
    audit?.record("authorized_judicial_provider_http_error", { error: String(error.message || error) });
    return { records: [], source: "" };
  });
  records.push(...normalizeRecords(company, remote.records, remote.source));

  for (const result of dataSourceResults || []) {
    if (!result?.ok || !result.normalized) continue;
    const sourceText = `${result.sourceId} ${result.normalized.sourceType} ${result.normalized.sourceName}`;
    const isJudicialProvider = /judicial|court|enforcement|lawsuit|legal|司法|法院|执行|裁判/i.test(sourceText);
    if (!isJudicialProvider) continue;
    records.push(...normalizeRecords(company, result.normalized.records || [], result.requestUrl || result.sourceId));
  }

  const judgments = records.filter((item) => /judg|裁判|文书|判决|案件|court|lawsuit/i.test(`${item.type} ${item.category} ${item.title} ${item.summary}`));
  const enforcement = records.filter((item) => /enforcement|执行|被执行|失信|zxgk/i.test(`${item.type} ${item.category} ${item.title} ${item.summary}`));
  return {
    ok: judgments.length > 0 || enforcement.length > 0,
    company,
    records,
    judgments,
    enforcement,
    sourceFile: file || remote.source || ""
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderAuthorizedEvidenceHtml({ title, company, records, sourceFile }) {
  const rows = (records || []).map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.title || item.type || item.category || "授权记录")}</td>
      <td>${escapeHtml(item.summary || item.result || item.status || "见授权数据")}</td>
      <td>${escapeHtml(item.url || item.providerSource || sourceFile || "")}</td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; margin: 28px; color: #172033; }
    h1 { font-size: 24px; margin: 0 0 10px; }
    .meta { color: #526071; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { border: 1px solid #cfd7e3; padding: 10px; vertical-align: top; text-align: left; }
    th { background: #eef3f8; }
    .seal { margin-top: 18px; color: #39516f; font-size: 13px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">主体：${escapeHtml(company)} | 采集时间：${new Date().toISOString()} | 来源：${escapeHtml(sourceFile || "authorized-provider")}</div>
  <table>
    <thead><tr><th>序号</th><th>标题</th><th>摘要/状态</th><th>来源</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4">授权数据源返回无匹配记录。</td></tr>'}</tbody>
  </table>
  <div class="seal">本页由已配置授权司法数据通道生成，用于补充官方门户不可用时的可审计证据。</div>
</body>
</html>`;
}

async function captureAuthorizedEvidence(page, { outDir, company, title, records, sourceFile, add, shots }) {
  const htmlPath = path.join(outDir, `${Date.now()}-${title}.html`.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_"));
  fs.writeFileSync(htmlPath, renderAuthorizedEvidenceHtml({ title, company, records, sourceFile }), "utf8");
  const file = add(title);
  await page.goto(`file://${htmlPath.replace(/\\/g, "/")}`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.screenshot({ path: file, fullPage: false });
  const entry = {
    slot: shots.length + 1,
    name: title,
    screenshot: file,
    text: fs.readFileSync(htmlPath, "utf8"),
    url: `authorized-provider://${encodeURIComponent(title)}`,
    evidenceLevel: "authorized-provider",
    authorizedProvider: true,
    html: htmlPath,
    validation: { ok: true, problems: [] }
  };
  shots.push(entry);
  return entry;
}

module.exports = {
  fetchAuthorizedRecords,
  loadAuthorizedJudicialData,
  captureAuthorizedEvidence,
  renderAuthorizedEvidenceHtml
};
