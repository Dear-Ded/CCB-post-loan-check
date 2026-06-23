# Doubao Package

This package adapts `CCB贷前贷后查询` for Doubao App office-task mode on Ubuntu/Linux.

## Quick Load

```text
加载 https://github.com/Dear-Ded/CCB-post-loan-check 这个项目，使用 CCB贷前贷后查询，给 XXX 公司生成贷后查询 Word 报告。
```

## Hard Rules

- 不得模拟。
- 不得墨迹。
- 不能胡编乱造数据。
- 必须原原本本执行项目脚本。
- 正式司法/执行输出必须来自法院官方页面成功查询截图；补充材料不能替代正式证据。

## Run

```bash
bash packages/doubao/preflight_doubao_app.sh
bash packages/doubao/run_doubao_app.sh --company "企业名" --mode enhanced --json
```

Optional personal enforcement checks are single-company only:

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "企业名" \
  --person "姓名|身份证号" \
  --mode enhanced \
  --json
```

## Output

- Single: `贷后查询-{企业名称}-{yyyyMMdd}.docx`
- Batch: `batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/reports`
- Evidence: `batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/evidence`

The final answer to the user should expose the Word file, the `reports` folder, or a downloadable result link. Evidence folders are retained for audit.
