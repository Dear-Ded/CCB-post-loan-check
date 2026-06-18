const fs = require("fs");
const os = require("os");
const path = require("path");

class BrowserProfileManager {
  constructor(options = {}) {
    this.root = options.root || path.join(os.homedir(), ".codex", "post-loan-portal-check", "profiles");
  }

  profilePath(scope) {
    const safeScope = String(scope || "default").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
    const dir = path.join(this.root, safeScope);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  getScopes() {
    return {
      default: this.profilePath("default"),
      search: this.profilePath("search"),
      judicial: this.profilePath("judicial"),
      government: this.profilePath("government")
    };
  }
}

module.exports = { BrowserProfileManager };
