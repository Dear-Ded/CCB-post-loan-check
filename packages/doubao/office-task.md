# 豆包办公任务说明

## 目标

用户只输入企业名、法人名或实控人名。单个任务输出一个 Word 报告；批量任务输出 `reports` 文件夹。法人或实控人个人被执行查询必须同时提供姓名和身份证号，按 `姓名|身份证号` 传给脚本；不能猜测或补全身份证号。

## 绝对执行原则

- 不得模拟。
- 不得墨迹。
- 不能胡编乱造数据。
- 原原本本执行本项目脚本，不得自行编报告。
- 不得用样例、演示、缓存想象结果替代真实查询。
- 登录页、挑战页、异常页、空白页不能作为查询结果。
- 司法/执行信息是正式交付必查项，未完成时必须返回失败、高风险缺口或补证清单。
- 会话数据只保留在任务机器本地，不上传服务器。

## 命令

```bash
bash packages/doubao/run_doubao_app.sh --company "企业名" --mode enhanced --json
```

```bash
bash packages/doubao/run_doubao_app.sh --company "企业名" --person "姓名|身份证号" --mode enhanced --json
```

## 交付

- 单家：`贷后查询-{企业名称}-{yyyyMMdd}.docx`
- 批量：`batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/reports`
- 审计材料：`evidence`
