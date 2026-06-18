const { spawnSync } = require("child_process");

class OcrSolver {
  constructor({ pythonExe = "python", helperPath, enabled = false, audit } = {}) {
    this.pythonExe = pythonExe;
    this.helperPath = helperPath;
    this.enabled = enabled;
    this.audit = audit;
  }

  canSolve() {
    return Boolean(this.enabled && this.helperPath);
  }

  solveImage(imagePath, sourceId = "unknown") {
    if (!this.canSolve()) return { ok: false, text: "", reason: "ocr_disabled" };
    const result = spawnSync(this.pythonExe, [this.helperPath, imagePath], {
      encoding: "utf8",
      timeout: 15000
    });
    if (result.status !== 0) {
      const reason = result.stderr || result.stdout || `exit ${result.status}`;
      this.audit?.record("ocr_failed", { sourceId, reason });
      return { ok: false, text: "", reason };
    }
    const text = String(result.stdout || "").trim();
    this.audit?.record("ocr_completed", { sourceId, textLength: text.length });
    return { ok: true, text, reason: "" };
  }
}

module.exports = { OcrSolver };
