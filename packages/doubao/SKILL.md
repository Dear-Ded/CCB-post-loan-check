---
name: ccb-post-loan-doubao-app
description: Run CCB贷前贷后查询 inside Doubao App office-task mode. Use when the user gives Chinese enterprise names and asks for贷前/贷后查询,门户查询,截图留痕,Word报告,or batch reports. Optimized for Ubuntu 22.04, no sudo, no service listener, 120-second foreground commands, 10-minute background tasks, 2GB process memory, and direct Word/reports output.
---

# CCB贷前贷后查询 for 豆包 App

用户只要给企业名。单家输出 Word，批量输出 `reports` 文件夹。

## Run

Single:

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "濮阳豫能综合能源有限公司" \
  --org-code "91410926MACJQ2HCXH" \
  --skip-judicial --skip-search --json
```

Batch:

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "企业A,企业B" \
  --org-code "代码A,代码B" \
  --skip-judicial --skip-search --json
```

## Platform Rules

- Do not use sudo, Docker, VPN, or a long-running local service.
- Keep foreground commands under 120 seconds when possible.
- For larger batches, split into small chunks and return the current `reports` folder before the 10-minute task limit.
- Use headless browser mode unless judicial login/captcha needs user assistance.
- Never output login, captcha, error, or blank pages as final evidence.

