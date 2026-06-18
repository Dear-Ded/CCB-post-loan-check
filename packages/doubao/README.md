# Doubao Task Mode Package

This package adapts the workflow for Doubao task mode.

## Design Target

Doubao task mode should run the workflow as a browser-state task:

- On PC clients, use the local Doubao browser session when available.
- On Web clients, use the remote virtual browser session.
- On Doubao App office-task mode, prefer direct skill/task execution and direct Word or `reports` output.
- If the mobile App cannot run the required browser/file task directly, let the user start and supervise the task while execution happens in the cloud or PC worker.
- For batch tasks, keep the user-facing output to the `reports` folder and keep screenshots/audit evidence under `evidence`.
- Do not assume local Windows paths exist in a remote task environment; use the packaged scripts when available, otherwise reproduce the same browser workflow and output contract.

## Local Entry

If Doubao runs on a PC client with local file access, call:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\doubao\run_doubao_local.ps1 `
  -CompanyName "濮阳豫能综合能源有限公司" `
  -OrgCode "91410926MACJQ2HCXH" `
  -SkipJudicial -SkipSearch -Json
```

For batch:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\doubao\run_doubao_local.ps1 `
  -CompanyName "企业A,企业B" `
  -OrgCode "代码A,代码B" `
  -SkipJudicial -SkipSearch -Json
```

For Doubao App mobile entry, call the mobile wrapper when a script bridge is available. If the App's office-task mode can load skills directly, read `mobile-task.md` and execute the same state machine in the App task environment. If not, this wrapper represents the fallback handoff to a cloud or PC worker.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\doubao\run_doubao_mobile.ps1 `
  -CompanyName "濮阳豫能综合能源有限公司" `
  -OrgCode "91410926MACJQ2HCXH" `
  -SkipJudicial -SkipSearch -Json
```

Inside Doubao App office-task mode on Ubuntu, use the Linux entrypoint:

```bash
bash packages/doubao/preflight_doubao_app.sh
bash packages/doubao/run_doubao_app.sh \
  --company "濮阳豫能综合能源有限公司" \
  --org-code "91410926MACJQ2HCXH" \
  --skip-judicial --skip-search --json
```

## User Handoff

At the beginning of the task, tell the user:

- The mobile App may execute the office task directly; if the current environment cannot run the browser or file workflow, the same task is handed to a cloud or PC worker.
- China Judgments Online may require login.
- China Enforcement Information may require login.
- China Enforcement Information often loads poorly; retry is normal.
- The user may need to input captchas multiple times.
- The task will not screenshot until the result/no-result page is confirmed.

## Browser State Machine

1. Open all pages requiring human action.
2. Wait for login and captcha readiness.
3. Fill all non-captcha fields.
4. Wait for user captcha input.
5. Submit query.
6. If captcha fails or no result state appears, stay on the page and wait for new captcha input.
7. Capture only confirmed result/no-result pages.
8. Generate the Word report.
9. For batch tasks, collect all Word files into `reports` and keep per-company evidence under `evidence`.
