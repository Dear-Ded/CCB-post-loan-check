const { spawnSync } = require("child_process");

function normalizeImageText(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\dA-Za-z+\-×xX=一二三四五六七八九十零〇]/g, "");
}

function looksUsableImageText(value) {
  const text = normalizeImageText(value);
  return text.length >= 2 && text.length <= 12;
}

function parseProviders(value, helperPath) {
  const items = String(value || "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length && helperPath) return [{ id: "optional-local", helperPath }];
  return items.map((item) => {
    const [id, path] = item.split("=");
    return {
      id: id || "provider",
      helperPath: path || helperPath
    };
  }).filter((item) => item.helperPath);
}

class OcrSolver {
  constructor({ pythonExe = "python", helperPath, providers = process.env.POST_LOAN_IMAGE_TEXT_PROVIDERS || "", enabled = false, audit } = {}) {
    this.pythonExe = pythonExe;
    this.helperPath = helperPath;
    this.providers = parseProviders(providers, helperPath);
    this.enabled = enabled;
    this.audit = audit;
  }

  canSolve() {
    return Boolean(this.enabled && this.providers.length);
  }

  solveImage(imagePath, sourceId = "unknown") {
    if (!this.canSolve()) return { ok: false, text: "", reason: "image_text_recognition_disabled" };
    const failures = [];
    const candidates = [];
    const rounds = Math.max(1, Number(process.env.POST_LOAN_IMAGE_TEXT_ROUNDS || 2));
    for (const provider of this.providers) {
      for (let round = 1; round <= rounds; round += 1) {
        const result = spawnSync(this.pythonExe, [provider.helperPath, imagePath], {
          encoding: "utf8",
          timeout: Number(process.env.POST_LOAN_IMAGE_TEXT_TIMEOUT_MS || 15000),
          env: { ...process.env, POST_LOAN_IMAGE_TEXT_ROUND: String(round) }
        });
        if (result.status !== 0) {
          const reason = result.stderr || result.stdout || `exit ${result.status}`;
          failures.push({ provider: provider.id, round, reason });
          this.audit?.record("image_text_recognition_provider_failed", { sourceId, provider: provider.id, round, reason });
          continue;
        }
        const rawText = String(result.stdout || "").trim();
        const text = normalizeImageText(rawText);
        if (!looksUsableImageText(text)) {
          failures.push({ provider: provider.id, round, reason: "unusable_text", rawText: rawText.slice(0, 40) });
          continue;
        }
        candidates.push({ provider: provider.id, round, text, rawText });
      }
    }
    if (candidates.length) {
      const counts = new Map();
      for (const candidate of candidates) counts.set(candidate.text, (counts.get(candidate.text) || 0) + 1);
      candidates.sort((a, b) => (counts.get(b.text) - counts.get(a.text)) || a.text.length - b.text.length);
      const best = candidates[0];
      this.audit?.record("image_text_recognition_completed", {
        sourceId,
        provider: best.provider,
        textLength: best.text.length,
        candidateCount: candidates.length,
        agreement: counts.get(best.text)
      });
      return { ok: true, text: best.text, provider: best.provider, reason: "", candidates };
    }
    return { ok: false, text: "", reason: failures.map((item) => `${item.provider}:${item.reason}`).join("; ") || "no_provider_succeeded" };
  }
}

module.exports = { OcrSolver };
