---
name: ccb-post-loan-doubao-app
description: Run CCB贷前贷后查询 inside Doubao App office-task mode on Ubuntu/Linux. Use when the user gives Chinese enterprise names and asks for due diligence, public information aggregation, screenshots, Word reports, or batch reports.
---

# CCB贷前贷后查询 for 豆包 App 办公任务

The user only needs to provide enterprise names. A single task outputs one Word report; a batch task outputs a `reports` folder.
If the user also asks for legal representative or controller personal enforcement checks, only pass values that include both exact name and ID number in `name|idNumber` form. Do not infer or invent personal IDs.

## Hard Rules

- 不得模拟。
- 不得墨迹。
- 不能胡编乱造数据。
- 必须原原本本执行查询脚本。
- 不能生成演示报告、样例报告、合成截图或占位数据。
- 未确认真实结果页或真实无结果页前，不得把页面写入最终 Word。
- 失败就返回失败原因、补证清单或可重试状态，不得把失败伪装成成功。

## Linux Run

```bash
bash packages/doubao/preflight_doubao_app.sh
bash packages/doubao/run_doubao_app.sh \
  --company "企业名称" \
  --org-code "统一社会信用代码或组织机构代码" \
  --mode enhanced \
  --json
```

Optional single-company personal enforcement check:

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "企业名" \
  --person "姓名|身份证号" \
  --mode enhanced \
  --json
```

For batch input, pass newline-, comma-, Chinese-comma-, or ideographic-comma-separated company names through `--company`.
Do not pass `--person` in batch mode.

## Delivery

Return the Word report, the `reports` folder, or a downloadable link. Do not present screenshots individually unless the user explicitly asks for audit evidence.
