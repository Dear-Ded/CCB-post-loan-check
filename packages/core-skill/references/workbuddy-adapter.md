# WorkBuddy Adapter

WorkBuddy packaging is designed for non-technical users and has one supported platform entrypoint.

## Platform Routing

- WorkBuddy desktop: Windows, use `workbuddy/run_workbuddy.ps1`.
- WorkBuddy mobile: unsupported for this project. Do not expose a Linux/bash WorkBuddy entrypoint.
- Mobile Linux office-task execution belongs to the Doubao App adapter.

Do not call the bash compatibility script from WorkBuddy product surfaces.

## Desktop Entry

```powershell
.\workbuddy\run_workbuddy.ps1 `
  -CompanyName "{companyName}" `
  -OrgCode "{orgCode}" `
  -Person "张三|身份证号" `
  -Mode "enhanced" `
  -Json
```

## Hard Rules

- Execute the project runner as-is.
- Do not create simulated reports, sample screenshots, invented source data, or fabricated failure reasons.
- If a source requires user confirmation, say that the page is ready and wait for a real result/no-result state.
- Final output is one Word report or a `reports` folder.

Session data remains on the local machine and is not uploaded to any server.
