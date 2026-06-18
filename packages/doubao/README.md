# Doubao Task Mode Package

This package adapts the workflow for Doubao task mode.

## Design Target

Doubao task mode should run the workflow as a browser-state task:

- On PC clients, use the local Doubao browser session when available.
- On Web clients, use the remote virtual browser session.
- On mobile, let the user start and supervise the task while browser execution happens in the task environment.
- For batch tasks, keep the user-facing output to the `reports` folder and keep screenshots/audit evidence under `evidence`.
- Do not assume local Windows paths exist in a remote task environment; use the packaged scripts when available, otherwise reproduce the same browser workflow and output contract.

## User Handoff

At the beginning of the task, tell the user:

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
