---
name: post-loan-portal-check
description: Run desktop-agent post-loan external information checks for Chinese enterprise names and optional legal representative/controller personal execution-only checks. Use when the user says "贷后查询", "门户查询", "外部信息查询", provides a company name, or wants fixed portal searches, screenshots, validation, and a Word report named "贷后查询-企业名称-日期". Covers Henan emergency management, ecology/environment, market regulation, China Judgments Online, China Enforcement Information, Baidu first three pages, optional Henan Health Commission for hospital/medical entities, and optional person execution checks by name plus ID number. The agent should ask only once at startup for login/captcha/person ID needs, then execute automatically.
---

# Post Loan Portal Check

Use this skill through a desktop agent such as WorkBuddy or Codex. The agent should handle all normal typing, clicking, searching, screenshots, and Word assembly. The user should only be asked for actions the agent cannot lawfully or reliably do: account login, captcha, and personal ID numbers for person-subject checks.

## Startup Contract

At task start, ask once:

1. Whether to synchronously query execution information for the legal representative and/or actual controller.
2. If yes, ask for each person's exact name and ID number.
3. Whether the company is a hospital/medical institution. If yes, include Henan Health Commission.
4. If the unified social credit code / organization code is not supplied, look it up automatically from public enterprise search results first. Ask the user only if the lookup is missing or ambiguous.
5. Tell the user to log in to China Judgments Online in the opened Chrome window.
6. Tell the user that China Enforcement Information may also require login and often loads poorly; the script will retry the query page until the form is usable.
7. Tell the user to type the captcha on every pre-filled China Enforcement Information query page. If the captcha is wrong or expires, the script will not screenshot; it will keep the page open and wait for the user to type a new captcha until a real result/no-result state is confirmed.

After startup, do not ask the user to come back and say "done". The script detects login and captcha input automatically, then continues.

## Current Codex Command

Before running the command, determine `-OrgCode`. If it was not given, search the web for the enterprise's unified social credit code and use the best confirmed exact match.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File C:\Users\80983\.codex\skills\post-loan-portal-check\scripts\run_post_loan_check.ps1 `
  -CompanyName "企业名称" `
  -OrgCode "统一社会信用代码或组织机构代码" `
  -TemplateSlots
```

Optional people:

```powershell
-Person "张三|身份证号" -Person "李四|身份证号"
```

Optional hospital/medical portal:

```powershell
-IncludeHealthCommission
```

## Required Content Standards

- Henan portals must be search result pages, not home pages with a filled search box.
- China Judgments Online must be a result/list page for the company, not the portal home page or login page.
- China Enforcement Information must be a comprehensive query result page with the subject name and certificate/org-code filled; if no data exists, capture the no-result page.
- China Enforcement Information must not be captured immediately after captcha input. Confirm the search reached a result/no-result state; if captcha fails, wait for a new captcha input and retry.
- Person checks only query execution information on China Enforcement Information. Do not query personal judgments, Baidu, or other portals for people.
- Person execution checks must capture the full no-result page if empty. If records exist, open each detail page and capture all visible information.
- Baidu must capture the first three result pages completely. The number of screenshots is dynamic; if one page needs more than two viewport screenshots, continue scrolling and capture every segment needed for complete visible coverage.
- Hospital/medical entities must include an additional Henan Health Commission portal search screenshot.
- Do not bypass captchas or access controls.

## Output

Default output root:

`D:\项目文件\中建黄河大桥贷后\outputs`

Final report name:

`贷后查询-<企业名称>-<yyyyMMdd>.docx`

The builder copies `assets/贷后查询模板.docx` and replaces the template media slots directly. If the run produces more screenshots than the template's original slots, append cloned image paragraphs using the same inline image geometry so completeness wins over a fixed screenshot count.
