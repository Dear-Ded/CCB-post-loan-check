# CCB贷前贷后查询

> 面向企业私有化部署的贷前/贷后外部信息查询、截图留痕与 Word 报告生成工具。

![Codex](https://img.shields.io/badge/Codex-skill%20ready-111827)
![WorkBuddy](https://img.shields.io/badge/WorkBuddy-expert%20package-2563eb)
![Doubao](https://img.shields.io/badge/Doubao-office%20task-16a34a)
![License](https://img.shields.io/badge/license-MIT-64748b)

用户只需要输入企业名或批量企业名单。系统负责打开公开或授权访问的数据源、填写主体、处理挑战策略、校验结果页、截图留痕，并按统一模板生成 Word 报告。批量任务会把最终 Word 统一归集到 `reports` 文件夹，截图和审计材料留在 `evidence`。

## 核心体验

- 小白用户：输入企业名，拿 Word。
- 批量用户：粘贴企业名单，拿 `reports` 文件夹。
- 企业管理员：启用私有化档位，全局确认后能力默认全开，再按源关闭。
- 审计人员：每次挑战、失败、截图、报告路径都有证据链。

## 平台适配

| 平台 | 形态 | 入口 | 输出 |
| --- | --- | --- | --- |
| Codex | 本地 skill/plugin | `run-post-loan-check.ps1` / `run-batch-post-loan-check.ps1` | Word / reports |
| WorkBuddy | skill、专家、专家团 | `workbuddy/run_workbuddy.ps1` | JSON + Word / reports |
| 豆包办公任务 | 浏览器/云端电脑任务 | `packages/doubao/office-task.md` | Word / reports |

## 查询范围

- 河南省应急管理厅
- 河南省生态环境厅
- 河南省市场监督管理局
- 中国裁判文书网
- 中国执行信息公开网
- 搜索引擎结果页
- 医院/医疗机构补充卫健委查询：属地优先，属地不可用或无主体结果时切河南省卫健委
- 可选法人/实控人被执行信息查询：必须由用户提供姓名和身份证号

## 快速开始

单家企业：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-post-loan-check.ps1 `
  -CompanyName "濮阳豫能综合能源有限公司" `
  -OrgCode "91410926MACJQ2HCXH" `
  -TemplateSlots -SkipJudicial -NoPrompt
```

批量企业：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-batch-post-loan-check.ps1 `
  -CompanyName "企业A,企业B,企业C" `
  -OrgCode "代码A,代码B,代码C" `
  -TemplateSlots -SkipJudicial -NoPrompt -MaxAttempts 2
```

WorkBuddy JSON：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\core-skill\workbuddy\run_workbuddy.ps1 `
  -CompanyName "濮阳豫能综合能源有限公司" `
  -OrgCode "91410926MACJQ2HCXH" `
  -SkipJudicial -SkipSearch -Json
```

## 输出结构

默认输出目录：

```text
%USERPROFILE%\Documents\CCB贷前贷后查询\outputs
```

单家报告：

```text
贷后查询-{企业名称}-{yyyyMMdd}.docx
```

批量报告：

```text
batch-post-loan-{yyyyMMdd-HHmmss}/
  reports/        最终 Word 报告
  evidence/       每家企业截图、manifest、audit 证据
  batch-summary.json
```

## 挑战处理策略

普通公开、授权、内部数据源默认 `auto`，OCR、自动填充、自动重试开箱即用。司法、政务、强风控门户在普通模式下默认托管处理。企业私有化部署可以启用全源自动档位。

企业私有化部署：

```powershell
$env:POST_LOAN_DEPLOYMENT_PROFILE = "enterprise-private"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\core-skill\scripts\confirm_challenge_risk.ps1 -Accept -EnterprisePrivate
```

撤销全局确认：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\core-skill\scripts\confirm_challenge_risk.ps1 -Revoke
```

可选配置：

```powershell
$env:POST_LOAN_OUTPUT_ROOT = "D:\reports"
$env:POST_LOAN_ENABLE_LOW_RISK_OCR = "1"
$env:POST_LOAN_CHALLENGE_POLICY = ".\packages\core-skill\references\challenge-policy.example.json"
```

## 质量标准

- 不把登录页、验证码页、异常页、空白页作为结果页。
- 执行公开网必须确认结果/无结果状态后才截图。
- 搜索引擎必须同一来源前三页完整可用才输出；中途触发验证、登录或异常流量则整组放弃。
- 医院/医疗机构卫健委查询属地优先，属地不可用或无主体结果时切省级。
- 批量查询只向用户交付 `reports`，截图和审计留在 `evidence`。

## 文档

- [平台适配矩阵](ADAPTERS.md)
- [挑战处理引擎调研](CHALLENGE_ENGINE_RESEARCH.md)
- [通用数据源接入框架产品架构方案](通用数据源接入框架产品架构方案.md)
- [豆包办公任务说明](packages/doubao/office-task.md)

## 合规边界

本项目用于公开数据源或经授权访问数据源的信息归集和证据留痕。企业私有化部署模式下，企业管理员可启用全源自动处理，并由企业自行承担授权、访问频率、账号风险和合规策略管理责任。所有挑战处理决策写入 audit，便于审计。
