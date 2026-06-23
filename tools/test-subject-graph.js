const assert = require("assert");
const { buildSubjectGraph } = require("../packages/core-skill/scripts/framework/subject_graph");

async function main() {
  const calls = [];
  const registry = {
    async query(subject) {
      calls.push(subject);
      if (subject === "根企业") {
        return [{
          ok: true,
          normalized: {
            records: [{
              sourceId: "mock",
              sourceName: "Mock Source",
              url: "https://example.test/root",
              confidence: 0.9,
              relatedSubjects: [
                { name: "供应商A", relation: "supplier", confidence: 0.8 },
                { name: "客户B", relation: "customer", confidence: 0.7 }
              ]
            }]
          }
        }];
      }
      if (subject === "供应商A") {
        return [{
          ok: true,
          normalized: {
            records: [{
              sourceId: "mock",
              sourceName: "Mock Source",
              url: "https://example.test/supplier",
              confidence: 0.6,
              relatedSubjects: [
                { name: "二级关联C", relation: "invested", confidence: 0.5 }
              ]
            }]
          }
        }];
      }
      return [];
    }
  };

  const graph = await buildSubjectGraph({
    registry,
    rootSubject: "根企业",
    maxDepth: 3,
    maxNodes: 4
  });

  assert.equal(graph.schemaVersion, "subject-graph/v0");
  assert.equal(graph.rootSubject, "根企业");
  assert(graph.nodes.some((node) => node.name === "供应商A"));
  assert(graph.nodes.some((node) => node.name === "客户B"));
  assert(graph.edges.some((edge) => edge.from === "根企业" && edge.to === "供应商A" && edge.relation === "supplier"));
  assert(calls.includes("根企业"));
  assert(calls.includes("供应商A"));
  assert(graph.nodes.length <= 4);
  console.log("subject-graph ok");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
