# WorkBuddy Package

WorkBuddy users should see only a simple form and one startup instruction screen.

## Form Fields

- Enterprise name.
- Optional unified social credit code / organization code.
- Hospital or medical institution switch.
- Legal representative / actual controller execution-check switch.
- Person rows with name and ID number when personal checks are enabled.

## Runtime Flow

1. Run preflight.
2. Explain missing browser/runtime/template/output permissions in plain language.
3. Open browser pages that require human action.
4. Ask the user once to log in and type captchas.
5. Detect readiness automatically.
6. Query, validate, screenshot, and build Word.

Users should not need to understand PowerShell, Python, Node.js, browser profiles, or file paths.
