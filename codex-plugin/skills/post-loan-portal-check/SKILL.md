---
name: post-loan-portal-check
description: Run CCB 贷前贷后查询 for Chinese enterprise names. Use when the user provides company names and asks for portal checks, screenshots, validation, and a Word report.
---

# CCB 贷前贷后查询

The user should only need to provide enterprise names. The skill handles portal navigation, subject entry, screenshots, validation, Word assembly, and batch report collection.

## Startup Contract

Ask once at startup:

1. Whether to query legal representative or actual controller execution information.
2. If yes, ask for each person's exact name and ID number.
3. Whether the company is a hospital or medical institution. If yes, include the health commission source.
4. If the unified social credit code or organization code is not supplied, look it up from public enterprise search results first. Ask the user only if missing or ambiguous.
5. Tell the user that China Judgments Online and China Enforcement Information may require login or a page challenge. The system keeps the browser ready and continues after a real result/no-result state is confirmed.

After startup, do not ask the user to come back and say done. The scripts detect result states automatically.

## Commands

One-click fast mode, when the user explicitly asks for 极速模式 / fastest mode / success-first mode:

```bash
npm run mode:fast
```

This writes local consent plus expert retry/session/browser-compatibility settings. Real evidence validation and managed confirmation for strong official-source challenges remain enabled.

Single company:

```powershell
.\run-post-loan-check.ps1 `
  -CompanyName "企业名称" `
  -OrgCode "统一社会信用代码或组织机构代码" `
  -TemplateSlots
```

Batch:

```powershell
.\run-batch-post-loan-check.ps1 `
  -CompanyName "企业A","企业B" `
  -OrgCode "企业A代码","企业B代码" `
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

Official source readiness check:

```bash
npm run diagnose:official -- --company "企业名称"
```

This check is read-only and never substitutes for required official screenshots.

## Required Content Standards

- Henan portals must be search result pages, not home pages with a filled search box.
- China Judgments Online must be a result/list page for the company, not the portal home page or login page.
- China Enforcement Information must be a comprehensive query result page with the subject name and certificate/org-code filled; if no data exists, capture the no-result page.
- Person checks only query execution information on China Enforcement Information.
- Search evidence must be complete for the same engine. If page 2 or page 3 triggers a challenge, login, rate limit, or invalid page, do not keep partial page 1 screenshots in the final report.
- Hospital/medical entities must prefer the local health commission site; if it is unavailable or does not provide a useful subject result, fall back to the provincial site.
- Judicial and execution sources are required for final delivery. If they are not completed, the task must fail or mark the gap as high risk rather than producing a complete-looking report.

## Output

Default output root:

`%USERPROFILE%\Documents\CCB贷前贷后查询\outputs`

Final report name:

`贷后查询-<企业名称>-<yyyyMMdd>.docx`

Batch output collects final Word files under `reports` and keeps screenshots, manifests, and audit logs under `evidence`.

## Policy

User session data stays on the local machine and is not uploaded to any server. Low-risk image text recognition is optional and disabled by default. Browser compatibility tuning is an advanced configuration under `references/runtime-policy.example.json` and is disabled by default.
