# CCB 贷前贷后查询

面向企业贷前、贷后场景的公开信息查询、截图留痕和 Word 报告生成工具。用户输入企业名，系统按统一数据源清单完成查询、校验、截图、归档和报告生成；批量查询时会把最终 Word 统一归集到 `reports` 文件夹。

目标平台：Codex、WorkBuddy、豆包办公任务。三个平台共用同一套核心脚本、同一套证据合同和同一套输出标准。

公开仓库：https://github.com/Dear-Ded/CCB-post-loan-check

## 项目铁律

- 不得模拟任何查询结果、截图、报告、证据或数据。
- 不得胡编乱造任何内容，包括企业信息、司法/执行结果、身份证号、来源链接、截图状态和失败原因。
- 未拿到真实结果页或真实无结果页时，必须返回真实失败原因、补证清单或可重试状态，不得伪装成功。
- 所有平台适配都必须原原本本执行项目脚本，不得用演示报告、样例截图、缓存想象结果替代真实查询。

## 查询范围

- 河南省应急管理厅
- 河南省生态环境厅
- 河南省市场监督管理局
- 中国裁判文书网
- 中国执行信息公开网
- 搜索引擎结果页
- 医院/医疗机构可选补充：属地卫健委优先，属地不可用时切换省级卫健委
- 可选法人、实控人执行信息查询，需要姓名和身份证号

司法和执行信息是正式交付必查项。正式报告必须包含中国裁判文书网、中国执行信息公开网的官方页面成功查询截图；授权数据源、搜索引擎或其他公开线索只能作为补充材料，不能替代正式证据。如果官方结果页未完成，任务会失败或在批量汇总中标注高风险原因，不生成看似完整的正式报告。

## 快速开始

```bash
npm install
python3 -m pip install -r requirements.txt --user
```

单家企业：

```powershell
.\run-post-loan-check.ps1 `
  -CompanyName "濮阳豫能综合能源有限公司" `
  -OrgCode "91410926MACJQ2HCXH" `
  -TemplateSlots
```

批量企业：

```powershell
.\run-batch-post-loan-check.ps1 `
  -CompanyName "企业A,企业B,企业C" `
  -OrgCode "代码A,代码B,代码C" `
  -TemplateSlots `
  -MaxAttempts 2
```

WorkBuddy JSON：

```powershell
.\packages\core-skill\workbuddy\run_workbuddy.ps1 `
  -CompanyName "濮阳豫能综合能源有限公司" `
  -OrgCode "91410926MACJQ2HCXH" `
  -Json
```

豆包办公任务 Ubuntu 入口：

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "濮阳豫能综合能源有限公司" \
  --org-code "91410926MACJQ2HCXH" \
  --mode enhanced \
  --json
```

如需同步查询法人或实控人的个人被执行信息，必须提供真实姓名和身份证号，格式为 `--person "姓名|身份证号"`；批量任务不接收个人查询参数，避免企业和个人证据混写。

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
batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/
  reports/        最终 Word 报告
  evidence/       每家企业截图、manifest、audit 证据
  batch-summary.json
  retry-plan.json
```

批量交付时给用户 `reports` 文件夹即可；截图和审计材料保留在 `evidence`。

## 授权会话与挑战项处理

- 用户会话数据仅存储在本地机器，不上传任何服务器。
- 登录页、挑战项页面、异常页、空白页只进入审计，不进入最终 Word。
- 普通公开数据源支持自动导航、自动填充、自动重试。
- 授权范围内的低风险图像文字识别为可选增强组件，默认关闭。
- 司法、政务、执行类数据源默认采用托管处理：系统预填主体和非挑战字段，并等待真实结果或无结果状态。
- 浏览器自动化测试与兼容性调试参数位于 `references/runtime-policy.example.json`，默认关闭。

## 可选增强组件

低风险图像文字识别组件不在默认安装包内。私有化部署如需启用，可在受信任目录运行：

```powershell
.\packages\core-skill\scripts\install_optional_image_text_recognition.ps1
```

## 质量标准

- 不把登录页、挑战项页、异常页、空白页作为结果页。
- 执行信息公开网必须确认结果或无结果状态后才截图。
- 裁判文书网必须输入主体并进入主体结果页后才截图。
- 搜索引擎必须捕获同一来源前三页完整结果；中途出现挑战项、登录或异常页时，不保留不完整截图进入最终报告。
- 医院/医疗机构卫健委查询属地优先，属地不可用或无主体结果时切换省级。
- 批量查询把最终 Word 统一归集到 `reports`。

## 验收

```powershell
.\tools\test-output-contract.ps1 `
  -OutputRoot "C:\path\to\outputs" `
  -Json
```

验收会检查 Word、manifest、截图、批量 `reports/evidence`，并拒绝内部烟测产物作为正式交付。

## 合规边界

本项目用于公开数据源或经授权访问数据源的信息归集和证据留痕。企业私有化部署场景下，企业管理员负责授权、访问频率、账号风险和合规策略管理。所有挑战项处理决策写入 audit，便于审计。
