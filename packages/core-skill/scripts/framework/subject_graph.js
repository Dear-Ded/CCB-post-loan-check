function normalizeSubjectName(value) {
  return String(value || "").replace(/\s+/g, "").trim();
}

function confidenceBucket(value) {
  const score = Number(value);
  if (score >= 0.75) return "high";
  if (score >= 0.45) return "medium";
  return "low";
}

function addNode(graph, name, depth, evidence = {}) {
  const normalized = normalizeSubjectName(name);
  if (!normalized) return null;
  const current = graph.nodes.get(normalized);
  if (current) {
    current.depth = Math.min(current.depth, depth);
    current.evidence.push(evidence);
    return current;
  }
  const node = {
    id: normalized,
    name: String(name),
    depth,
    evidence: evidence.sourceId ? [evidence] : []
  };
  graph.nodes.set(normalized, node);
  return node;
}

function addEdge(graph, from, to, relation, evidence = {}) {
  const fromId = normalizeSubjectName(from);
  const toId = normalizeSubjectName(to);
  if (!fromId || !toId || fromId === toId) return null;
  const id = `${fromId}->${toId}:${relation || "mentioned"}`;
  if (graph.edges.has(id)) return graph.edges.get(id);
  const edge = {
    id,
    from: fromId,
    to: toId,
    relation: relation || "mentioned",
    evidence: evidence.sourceId ? [evidence] : [],
    confidence: evidence.confidence || 0.5,
    confidenceLabel: confidenceBucket(evidence.confidence || 0.5),
    assertionType: evidence.assertionType || "inferred"
  };
  graph.edges.set(id, edge);
  return edge;
}

function extractRelatedSubjects(record) {
  return (record.relatedSubjects || [])
    .map((item) => ({
      name: normalizeSubjectName(item.name),
      displayName: item.name,
      relation: item.relation || "mentioned",
      confidence: item.confidence || record.confidence || 0.5
    }))
    .filter((item) => item.name);
}

async function buildSubjectGraph({ registry, rootSubject, maxDepth = 2, maxNodes = 25, audit } = {}) {
  const graph = { nodes: new Map(), edges: new Map(), queryResults: [] };
  const queue = [{ name: rootSubject, depth: 0, parent: "" }];
  const seen = new Set();
  addNode(graph, rootSubject, 0, { assertionType: "seed" });

  while (queue.length) {
    const item = queue.shift();
    const subjectId = normalizeSubjectName(item.name);
    if (!subjectId || seen.has(subjectId) || item.depth > maxDepth || graph.nodes.size >= maxNodes) continue;
    seen.add(subjectId);

    audit?.record("subject_graph_query_started", { subject: item.name, depth: item.depth });
    const results = await registry.query(item.name);
    graph.queryResults.push({ subject: item.name, depth: item.depth, results });

    for (const result of results) {
      if (!result.ok || !result.normalized) continue;
      for (const record of result.normalized.records || []) {
        const evidence = {
          sourceId: record.sourceId,
          sourceName: record.sourceName,
          url: record.url,
          confidence: record.confidence,
          assertionType: "inferred"
        };
        for (const related of extractRelatedSubjects(record)) {
          if (graph.nodes.size >= maxNodes) break;
          addNode(graph, related.displayName || related.name, item.depth + 1, evidence);
          addEdge(graph, item.name, related.displayName || related.name, related.relation, {
            ...evidence,
            confidence: related.confidence
          });
          if (item.depth + 1 < maxDepth && !seen.has(related.name) && graph.nodes.size < maxNodes) {
            queue.push({ name: related.displayName || related.name, depth: item.depth + 1, parent: item.name });
          }
        }
      }
    }
  }

  const output = {
    schemaVersion: "subject-graph/v0",
    rootSubject,
    maxDepth,
    maxNodes,
    generatedAt: new Date().toISOString(),
    nodes: [...graph.nodes.values()],
    edges: [...graph.edges.values()],
    queryResults: graph.queryResults
  };
  audit?.record("subject_graph_completed", {
    rootSubject,
    maxDepth,
    nodes: output.nodes.length,
    edges: output.edges.length
  });
  return output;
}

module.exports = {
  buildSubjectGraph,
  extractRelatedSubjects,
  normalizeSubjectName
};
