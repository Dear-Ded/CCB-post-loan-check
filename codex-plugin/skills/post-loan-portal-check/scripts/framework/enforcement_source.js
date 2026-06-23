const crypto = require("crypto");

const IMAGE_TEXT_CODE = "验证码";
const CHECK_CODE = "校验码";
const CONFIRM_ITEM = "确认项";
const QUERY = "查询";
const SEARCH = "搜索";

function isCaptchaFailure(text) {
  const body = String(text || "");
  return new RegExp(`${IMAGE_TEXT_CODE}.*(错误|不正确|有误|失效|为空)|${CHECK_CODE}.*(错误|不正确|有误)|请输入.*${IMAGE_TEXT_CODE}|${IMAGE_TEXT_CODE}不能为空|${CONFIRM_ITEM}.*(错误|失效|为空)`).test(body);
}

function isResultState(text) {
  return /查询结果|未查询到|暂无数据|没有找到|无符合条件|没有符合条件|无相关信息|查询无结果|案号|执行法院|立案时间|执行标的/.test(String(text || ""));
}

async function pageText(page) {
  return (await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")).replace(/\s+/g, " ");
}

async function getCaptchaState(page) {
  return page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img")];
    const img = imgs.find((node) => /captcha|verify|code|yzm|rand/i.test(`${node.id || ""} ${node.className || ""} ${node.src || ""}`));
    const input = document.querySelector("#yzm");
    const nameInput = document.querySelector("#pName");
    const cardInput = document.querySelector("#pCardNum");
    const courtInput = document.querySelector("#selectCourtId");
    const form = (input || nameInput || cardInput)?.closest("form");
    const buttons = [...document.querySelectorAll("button,input[type='button'],input[type='submit'],a")]
      .map((node) => ({
        text: (node.innerText || node.value || "").trim().slice(0, 40),
        id: node.id || "",
        className: String(node.className || ""),
        disabled: Boolean(node.disabled),
        href: node.href || ""
      }))
      .filter((item) => /查询|搜索|submit|search|btn/i.test(`${item.text} ${item.id} ${item.className} ${item.href}`))
      .slice(0, 8);
    const boxOf = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    const hidden = [...document.querySelectorAll("input[type='hidden']")]
      .map((node) => `${node.name || node.id || ""}=${node.value || ""}`)
      .filter(Boolean)
      .join("&");
    return {
      imageSrc: img ? img.src : "",
      imageCurrentSrc: img ? img.currentSrc : "",
      imageComplete: img ? Boolean(img.complete) : false,
      imageSize: img ? `${img.naturalWidth || 0}x${img.naturalHeight || 0}` : "",
      imageBox: boxOf(img),
      hidden,
      inputValue: input?.value || "",
      inputBox: boxOf(input),
      nameValue: nameInput?.value || "",
      cardValue: cardInput?.value || "",
      courtValue: courtInput?.value || "",
      formAction: form?.action || "",
      formMethod: form?.method || "",
      buttons
    };
  }).catch(() => ({
    imageSrc: "",
    imageCurrentSrc: "",
    imageComplete: false,
    imageSize: "",
    imageBox: null,
    hidden: "",
    inputValue: "",
    inputBox: null,
    nameValue: "",
    cardValue: "",
    courtValue: "",
    formAction: "",
    formMethod: "",
    buttons: []
  }));
}

async function getCaptchaImageDigest(page) {
  const locator = page.locator("img[src*='captcha'], img[src*='verify'], img[src*='code'], #captchaImg, .captcha img").first();
  if (!(await locator.isVisible({ timeout: 1000 }).catch(() => false))) {
    return { ok: false, reason: "captcha_image_not_visible" };
  }
  const buffer = await locator.screenshot({ timeout: 3000 }).catch(() => null);
  if (!buffer) return { ok: false, reason: "captcha_image_screenshot_failed" };
  return {
    ok: true,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    bytes: buffer.length
  };
}

async function getEnforcementDiagnosticState(page) {
  const state = await getCaptchaState(page);
  const digest = await getCaptchaImageDigest(page);
  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    captcha: state,
    captchaDigest: digest
  };
}

function captchaSignature(state) {
  return `${state.imageSrc}|${state.imageComplete}|${state.imageSize}|${state.hidden}`;
}

function digestSignature(digest) {
  return digest && digest.ok ? `${digest.sha256}|${digest.bytes}` : "";
}

async function waitForCaptchaChange(page, beforeState, timeoutMs = 8000, beforeDigest = null) {
  const before = captchaSignature(beforeState);
  const beforeImage = digestSignature(beforeDigest);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const next = await getCaptchaState(page);
    const nextDigest = await getCaptchaImageDigest(page);
    const stateChanged = captchaSignature(next) !== before;
    const imageChanged = beforeImage && digestSignature(nextDigest) && digestSignature(nextDigest) !== beforeImage;
    if ((stateChanged || imageChanged) && next.imageComplete) return next;
    await page.waitForTimeout(500);
  }
  return getCaptchaState(page);
}

function attachEnforcementResponseAudit(page, audit, subjectName) {
  if (page.__postLoanResponseAuditAttached) return;
  page.__postLoanResponseAuditAttached = true;
  page.on("response", async (response) => {
    const url = response.url();
    if (!/zxgk|zhzxgk|captcha|verify|yzm|search|query/i.test(url)) return;
    let body = "";
    const contentType = response.headers()["content-type"] || "";
    if (/json|text|html/.test(contentType)) {
      body = await response.text().catch(() => "");
    }
    audit?.record("enforcement_response", {
      subjectName,
      url,
      status: response.status(),
      contentType,
      bodySample: body.slice(0, 300)
    });
  });
}

async function waitUntil(page, label, predicate, timeoutMs = 10 * 60 * 1000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate().catch(() => false)) return true;
    if (page.isClosed && page.isClosed()) throw new Error(`Page closed while waiting for ${label}`);
    await page.waitForTimeout(1000);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

module.exports = {
  attachEnforcementResponseAudit,
  captchaSignature,
  digestSignature,
  getCaptchaImageDigest,
  getCaptchaState,
  getEnforcementDiagnosticState,
  isCaptchaFailure,
  isResultState,
  pageText,
  waitForCaptchaChange,
  waitUntil,
  constants: {
    CHECK_CODE,
    CONFIRM_ITEM,
    IMAGE_TEXT_CODE,
    QUERY,
    SEARCH
  }
};
