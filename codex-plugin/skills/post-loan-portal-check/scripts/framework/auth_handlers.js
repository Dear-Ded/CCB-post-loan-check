const crypto = require("crypto");

function readSecret(config = {}, key = "env") {
  if (config.value) return String(config.value);
  if (config[key] && process.env[config[key]]) return process.env[config[key]];
  return "";
}

function applyApiKeyAuth(request, config) {
  const token = readSecret(config);
  if (!token) return { request, ok: false, reason: "missing_api_key" };
  if (config.in === "query") {
    const url = new URL(request.url);
    url.searchParams.set(config.paramName || "api_key", token);
    return { request: { ...request, url: url.toString() }, ok: true };
  }
  return {
    request: {
      ...request,
      headers: {
        ...(request.headers || {}),
        [config.headerName || "x-api-key"]: token
      }
    },
    ok: true
  };
}

function applyBearerAuth(request, config) {
  const token = readSecret(config);
  if (!token) return { request, ok: false, reason: "missing_bearer_token" };
  return {
    request: {
      ...request,
      headers: {
        ...(request.headers || {}),
        authorization: `Bearer ${token}`
      }
    },
    ok: true
  };
}

function applyBasicAuth(request, config) {
  const username = readSecret(config, "usernameEnv") || config.username || "";
  const password = readSecret(config, "passwordEnv") || config.password || "";
  if (!username || !password) return { request, ok: false, reason: "missing_basic_credentials" };
  const encoded = Buffer.from(`${username}:${password}`).toString("base64");
  return {
    request: {
      ...request,
      headers: {
        ...(request.headers || {}),
        authorization: `Basic ${encoded}`
      }
    },
    ok: true
  };
}

function applyHmacAuth(request, config) {
  const secret = readSecret(config, "secretEnv");
  if (!secret) return { request, ok: false, reason: "missing_hmac_secret" };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = request.body || "";
  const payload = [request.method || "GET", new URL(request.url).pathname, timestamp, body].join("\n");
  const signature = crypto
    .createHmac(config.algorithm || "sha256", secret)
    .update(payload)
    .digest(config.encoding || "hex");
  return {
    request: {
      ...request,
      headers: {
        ...(request.headers || {}),
        [config.timestampHeader || "x-timestamp"]: timestamp,
        [config.signatureHeader || "x-signature"]: signature
      }
    },
    ok: true
  };
}

function applyAuth(request, auth = {}) {
  if (!auth || auth.type === "none" || auth.enabled === false) return { request, ok: true };
  if (auth.type === "api-key") return applyApiKeyAuth(request, auth);
  if (auth.type === "bearer") return applyBearerAuth(request, auth);
  if (auth.type === "basic") return applyBasicAuth(request, auth);
  if (auth.type === "hmac") return applyHmacAuth(request, auth);
  return { request, ok: false, reason: `unsupported_auth_type:${auth.type}` };
}

module.exports = {
  applyAuth,
  applyApiKeyAuth,
  applyBasicAuth,
  applyBearerAuth,
  applyHmacAuth
};
