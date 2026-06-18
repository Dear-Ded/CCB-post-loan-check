# WorkBuddy Deep Adapter Notes

Treat users as non-technical. They should not need to understand Node.js, Python, PowerShell execution policy, browser profiles, filesystem paths, permissions, templates, or dependency installation.

## User-Facing Form

Expose these fields:

- Company name: required.
- Unified social credit code / organization code: optional. If empty, the expert attempts lookup and asks only if it cannot determine a confident value.
- Hospital or medical institution: yes/no. If yes, add Henan Health Commission.
- Query legal representative / actual controller execution information: yes/no.
- Person list: required only when personal execution checks are selected. Each row contains exact name and ID number.

## Startup Screen

Show one instruction screen before the browser work begins:

1. Log in to China Judgments Online in the opened browser if it is not already logged in.
2. Type the captcha on every China Enforcement Information query tab that opens. WorkBuddy fills all company, name, code, and ID fields.
3. After doing that, do not return to the chat. The expert detects readiness and continues by itself.

No mid-run prompts unless a new captcha/session expiry blocks the run and was impossible to collect at startup.

## Runtime Strategy

Prefer background automation whenever possible:

- Use bundled Node/Python runtime if WorkBuddy provides one; otherwise run preflight and show a plain repair message.
- Use persistent browser profile for logged-in court sessions.
- Use direct portal search result URLs for Henan government portals.
- Use foreground browser only for login, captcha, and pages that reject background automation.
- Store outputs under a predictable user-visible folder and open/reveal it at the end.

Environment fallbacks:

- Windows + PowerShell allowed: run `scripts/run_post_loan_check.ps1`.
- Windows + PowerShell restricted: launch with `powershell.exe -NoProfile -ExecutionPolicy Bypass`.
- No bundled Node/Python: use WorkBuddy's packaged runtime or run `scripts/preflight_workbuddy.ps1 -Json` and explain the missing component in plain language.
- Browser unavailable: use WorkBuddy browser capability if exposed; otherwise ask the user to install Chrome in one sentence.
- Headless blocked by login/captcha: switch to headed browser automatically.

## Hard Rules

- Do not ask the user to type company names, org codes, or click search buttons after startup.
- Do not accept home pages as portal-search screenshots.
- Do not accept login pages, captcha pages, security-check pages, or blank pages as final screenshots.
- Personal checks are execution-only. Do not run personal judgment, Baidu, health, or other portal searches for individuals.
- For person execution checks, capture the no-result page if empty. If records exist, open every detail page and capture all visible information.
- Treat screenshot count as dynamic. Template examples may show 12 images, but the actual report must include as many screenshots as needed for complete coverage of Baidu result pages, long portal results, and detail pages.
- For hospitals/medical institutions, add Henan Health Commission portal search.
- Keep a manifest with source URL, screenshot path, validation result, and fallback reason for every screenshot.

## Friendly Failure Messages

Use non-technical messages:

- "还差一个验证码，我已经把其他信息填好了，请只输入验证码。"
- "裁判文书网登录过期了，我已停在登录页，请登录一次，后面我继续。"
- "这个网站今天返回异常页，我没有把它放进报告；我会改用站点限定检索并在记录里标明。"
- "报告没有生成，因为有页面还不是查询结果页。"
