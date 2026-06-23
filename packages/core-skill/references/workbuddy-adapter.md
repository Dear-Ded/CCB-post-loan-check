# WorkBuddy Adapter

WorkBuddy packaging is designed for non-technical users and has two platform entrypoints.

## Platform Routing

- WorkBuddy desktop: Windows, use `workbuddy/run_workbuddy.ps1`.
- WorkBuddy mobile: Linux, use `workbuddy/run_workbuddy.sh`.

Do not call the Windows PowerShell runner from mobile Linux. Do not call the bash runner from desktop Windows unless a Linux shell is explicitly available.

## Desktop Entry

```powershell
.\workbuddy\run_workbuddy.ps1 `
  -CompanyName "{companyName}" `
  -OrgCode "{orgCode}" `
  -Person "张三|身份证号" `
  -Mode "enhanced" `
  -Json
```

## Mobile Entry

```bash
bash workbuddy/run_workbuddy.sh \
  --company "{companyName}" \
  --org-code "{orgCode}" \
  --person "张三|身份证号" \
  --mode enhanced \
  --json
```

## Hard Rules

- Execute the project runner as-is.
- Do not create simulated reports, sample screenshots, or invented source data.
- If a source requires user confirmation, say that the page is ready and wait for a real result/no-result state.
- Final output is one Word report or a `reports` folder.

Session data remains on the local machine and is not uploaded to any server.
