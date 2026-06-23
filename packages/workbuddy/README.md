# WorkBuddy Package

Release `0.5.0`.

WorkBuddy should present one simple form, one startup notice, and one clean execution flow. On Linux, use `packages/core-skill/workbuddy/run_workbuddy.sh`; on Windows, use `packages/core-skill/workbuddy/run_workbuddy.ps1`.

## Fields

- Enterprise name
- Optional unified social credit code / organization code
- Hospital or medical institution switch
- Legal representative / actual controller execution-check switch
- Person rows with name and ID number when personal checks are enabled

## Runtime Flow

1. Run preflight.
2. Explain missing browser/runtime/template/output permissions in plain language.
3. Open browser pages that require user confirmation.
4. Ask the user once to complete required login or page confirmation.
5. Detect readiness automatically.
6. Query, validate, screenshot, and build Word.

The user should not need to understand PowerShell, Python, Node.js, browser profiles, or file paths.

## Linux Run

```bash
bash packages/core-skill/workbuddy/run_workbuddy.sh --company "企业名" --mode enhanced --json
```

WorkBuddy must execute the project runner as-is. It must not create simulated reports, sample screenshots, or invented source data.
