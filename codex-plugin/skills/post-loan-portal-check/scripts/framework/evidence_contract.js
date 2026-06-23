function validShots(manifest) {
  return (manifest.screenshots || []).filter((shot) => shot?.validation?.ok);
}

function matchByName(shots, name) {
  return shots.filter((shot) => String(shot.name || "").includes(name));
}

function matchByUrl(shots, fragment) {
  return shots.filter((shot) => String(shot.url || "").includes(fragment));
}

function makeItem({ id, label, required, matches, missingReason }) {
  return {
    id,
    label,
    required: Boolean(required),
    ok: matches.length > 0,
    matchedSlots: matches.map((shot) => shot.slot).filter((slot) => slot != null),
    matchedNames: matches.map((shot) => shot.name).filter(Boolean),
    missingReason: matches.length > 0 ? "" : missingReason
  };
}

function searchPageNo(name) {
  const text = String(name || "");
  const match = text.match(/(?:page-|第)([123])(?:页)?/i);
  return match ? Number(match[1]) : 0;
}

function searchPageMatches(shots) {
  const pages = new Map();
  for (const shot of shots) {
    const pageNo = searchPageNo(shot.name);
    if (!pageNo) continue;
    if (!pages.has(pageNo)) pages.set(pageNo, []);
    pages.get(pageNo).push(shot);
  }
  return [1, 2, 3].flatMap((pageNo) => pages.get(pageNo) || []);
}

function makeSearchPagesItem({ required, shots }) {
  const pages = new Map();
  for (const shot of shots) {
    const pageNo = searchPageNo(shot.name);
    if (!pageNo) continue;
    if (!pages.has(pageNo)) pages.set(pageNo, []);
    pages.get(pageNo).push(shot);
  }
  const missingPages = [1, 2, 3].filter((pageNo) => !(pages.get(pageNo) || []).length);
  const matches = searchPageMatches(shots);
  return {
    id: "search_engine_pages",
    label: "搜索引擎前三页",
    required: Boolean(required),
    ok: missingPages.length === 0,
    matchedSlots: matches.map((shot) => shot.slot).filter((slot) => slot != null),
    matchedNames: matches.map((shot) => shot.name).filter(Boolean),
    missingPages,
    missingReason: missingPages.length ? `missing_search_engine_pages:${missingPages.join(",")}` : ""
  };
}

function buildRequiredEvidence(manifest) {
  const shots = validShots(manifest);
  const judicialRequired = manifest.smokeQuick !== true && manifest.judicialEnabled !== false;
  const searchRequired = manifest.skipSearch !== true && manifest.searchResult?.skipped !== true;
  const healthRequired = manifest.includeHealthCommission === true;
  const persons = Array.isArray(manifest.persons) ? manifest.persons : [];

  const items = [
    makeItem({
      id: "portal_henan_emergency",
      label: "河南省应急管理厅",
      required: true,
      matches: matchByName(shots, "河南省应急管理厅"),
      missingReason: "missing_henan_emergency"
    }),
    makeItem({
      id: "portal_henan_ecology",
      label: "河南省生态环境厅",
      required: true,
      matches: matchByName(shots, "河南省生态环境厅"),
      missingReason: "missing_henan_ecology"
    }),
    makeItem({
      id: "portal_henan_market",
      label: "河南省市场监督管理局",
      required: true,
      matches: matchByName(shots, "河南省市场监督管理局"),
      missingReason: "missing_henan_market"
    }),
    makeItem({
      id: "portal_health_commission",
      label: "卫生健康委员会",
      required: healthRequired,
      matches: shots.filter((shot) => /卫生健康委员会|卫健委/.test(String(shot.name || ""))),
      missingReason: "missing_health_commission"
    }),
    makeItem({
      id: "judicial_wenshu",
      label: "中国裁判文书网",
      required: judicialRequired,
      matches: matchByUrl(shots, "wenshu.court.gov.cn"),
      missingReason: "missing_judgment_result"
    }),
    makeItem({
      id: "judicial_enforcement",
      label: "中国执行信息公开网",
      required: judicialRequired,
      matches: matchByUrl(shots, "zxgk.court.gov.cn").filter((shot) => String(shot.name || "").includes("中国执行信息公开网")),
      missingReason: "missing_enforcement_result"
    }),
    makeSearchPagesItem({ required: searchRequired, shots })
  ];

  for (const person of persons) {
    const name = String(person?.name || "");
    if (!name) continue;
    items.push(makeItem({
      id: `person_enforcement_${name}`,
      label: `个人被执行信息-${name}`,
      required: judicialRequired,
      matches: matchByUrl(shots, "zxgk.court.gov.cn").filter((shot) => String(shot.name || "").includes(name)),
      missingReason: `missing_person_enforcement:${name}`
    }));
  }

  const missingRequired = items.filter((item) => item.required && !item.ok);
  return {
    schemaVersion: "required-evidence/v1",
    ok: missingRequired.length === 0,
    items,
    missingRequired
  };
}

function assertRequiredEvidence(manifest) {
  const requiredEvidence = buildRequiredEvidence(manifest);
  if (!requiredEvidence.ok) {
    const missing = requiredEvidence.missingRequired
      .map((item) => `${item.id}:${item.missingReason}`)
      .join(", ");
    const error = new Error(`Required evidence is incomplete: ${missing}`);
    error.requiredEvidence = requiredEvidence;
    throw error;
  }
  return requiredEvidence;
}

module.exports = {
  buildRequiredEvidence,
  assertRequiredEvidence
};
