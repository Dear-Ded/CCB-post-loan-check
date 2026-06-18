const fs = require("fs");
const path = require("path");

class AuditLog {
  constructor(outDir) {
    this.outDir = outDir;
    this.events = [];
  }

  record(type, payload = {}) {
    const event = {
      type,
      at: new Date().toISOString(),
      ...payload
    };
    this.events.push(event);
    return event;
  }

  flush(fileName = "audit-events.json") {
    if (!this.outDir) return;
    fs.mkdirSync(this.outDir, { recursive: true });
    fs.writeFileSync(path.join(this.outDir, fileName), JSON.stringify(this.events, null, 2), "utf8");
  }
}

module.exports = { AuditLog };
