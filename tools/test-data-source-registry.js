const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { DataSourceRegistry } = require("../packages/core-skill/scripts/framework/data_source_registry");
const { SourceStateStore } = require("../packages/core-skill/scripts/framework/source_state_store");

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

async function main() {
  const requests = [];
  process.env.POST_LOAN_TEST_API_KEY = "test-token";
  const server = http.createServer((req, res) => {
    requests.push({ url: req.url, apiKey: req.headers["x-api-key"] || "" });
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.url.startsWith("/search")) {
      const url = new URL(req.url, "http://127.0.0.1");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        items: [
          {
            title: `${url.searchParams.get("q")} 行政许可`,
            summary: "公开信息测试记录",
            url: "https://example.test/record/1",
            publishedAt: "2026-06-20",
            relatedSubjects: [
              { name: "测试关联企业", relation: "supplier", confidence: 0.8 }
            ]
          }
        ]
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });

  const port = await listen(server);
  const stateFile = path.join(os.tmpdir(), `post-loan-source-state-${Date.now()}.json`);
  const registry = new DataSourceRegistry({
    config: {
      dataSources: [
        {
          id: "local_public_api",
          name: "本地公开 API",
          type: "http-api",
          enabled: true,
          endpoint: `http://127.0.0.1:${port}/search`,
          healthUrl: `http://127.0.0.1:${port}/health`,
          queryParam: "q",
          auth: {
            type: "api-key",
            env: "POST_LOAN_TEST_API_KEY",
            headerName: "x-api-key"
          },
          resultMapping: {
            recordsPath: "items",
            titlePath: "title",
            summaryPath: "summary",
            urlPath: "url",
            publishedAtPath: "publishedAt",
            relatedSubjectsPath: "relatedSubjects"
          }
        }
      ]
    },
    stateStore: new SourceStateStore({ file: stateFile })
  });

  const [health] = await registry.healthCheckAvailable();
  assert.equal(health.ok, true);
  assert.equal(health.status, 200);

  const [result] = await registry.query("企业名称");
  assert.equal(result.ok, true);
  assert.equal(result.normalized.schemaVersion, "subject-intelligence/v0");
  assert.equal(result.normalized.records.length, 1);
  assert.equal(result.normalized.records[0].sourceId, "local_public_api");
  assert.match(result.normalized.records[0].title, /企业名称/);
  assert.equal(result.normalized.records[0].relatedSubjects[0].name, "测试关联企业");
  assert(requests.some((item) => item.url.includes(encodeURIComponent("企业名称"))));
  assert(requests.some((item) => item.apiKey === "test-token"));
  assert.equal(JSON.parse(fs.readFileSync(stateFile, "utf8")).sources["datasource:local_public_api"].status, "healthy");

  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(stateFile, { force: true });
  console.log("data-source-registry ok");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
