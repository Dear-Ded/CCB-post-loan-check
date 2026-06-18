# CCB贷前贷后查询

面向 Codex、WorkBuddy、豆包办公任务的贷前/贷后外部信息查询工具。用户可以只输入企业名或一批企业名，系统负责打开公开或授权访问的数据源、填写主体、校验结果页、截图留痕，并按统一模板生成 Word 报告。

默认体验目标很简单：用户拿到的是 Word 报告或批量 `reports` 文件夹，不需要理解浏览器自动化、Node、Python、验证码、截图目录这些技术细节。

## 支持平台

- Codex：本地 skill/plugin，可用 `run-post-loan-check.ps1` 和 `run-batch-post-loan-check.ps1` 直接执行。
- WorkBuddy：按 skill、专家、专家团包装，提供非技术用户表单、预检和 JSON 结果。
- 豆包办公任务：按浏览器任务/云端电脑任务设计，使用同一输入、输出、校验契约。

## 查询范围

- 河南省应急管理厅
- 河南省生态环境厅
- 河南省市场监督管理局
- 中国裁判文书网
- 中国执行信息公开网
- 搜索引擎结果页
- 医院/医疗机构自动补充卫健委查询：属地优先，属地不可用或无主体结果时切河南省卫健委
- 可选法人/实控人被执行信息查询：必须由用户提供姓名和身份证号

## 快速使用

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

重试上一批失败项：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run-batch-post-loan-check.ps1 `
  -CompanyName "占位" -RetryFailed -TemplateSlots -SkipJudicial -NoPrompt -MaxAttempts 2
```

## 输出

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
batch-post-loan-{yyyyMMdd-HHmm}/
  reports/        最终 Word 报告
  evidence/       每家企业截图、manifest、audit 证据
  batch-summary.json
```

批量场景只需要把 `reports` 文件夹交给用户；截图和审计材料留在 `evidence`。

## 配置

一般不需要配置。若平台无法自动发现运行时，可设置环境变量：

```powershell
$env:POST_LOAN_NODE_EXE = "C:\path\to\node.exe"
$env:POST_LOAN_PYTHON_EXE = "C:\path\to\python.exe"
$env:POST_LOAN_NODE_MODULES = "C:\path\to\node_modules"
$env:POST_LOAN_CHROME_EXE = "C:\path\to\chrome.exe"
$env:POST_LOAN_OUTPUT_ROOT = "D:\reports"
```

也可以参考 `.env.example`。

## 挑战处理能力

项目内置挑战处理引擎，目标是达到企业级 RPA/数据接入框架的产品形态：

- 统一识别登录页、验证码页、人机验证页、频控页、安全网关和空白异常页。
- 普通公开、授权、内部数据源默认 `auto`，OCR、自动填充、自动重试开箱即用。
- 司法、政务、强风控门户默认托管处理，系统填主体，用户完成登录/验证码，系统继续跑。
- 禁止或异常风险场景自动阻断、冷却和审计。
- 所有挑战处理决策写入 audit，避免黑盒行为。

低风险 OCR 默认开启；如部署环境要求更保守，可关闭：

```powershell
$env:POST_LOAN_ENABLE_LOW_RISK_OCR = "0"
```

司法、政务、强风控站点默认仍为托管处理。如果高级用户或企业部署希望把这些来源改为 `auto`，首次使用前执行一次全局风险确认，之后不再按源反复提示：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\core-skill\scripts\confirm_challenge_risk.ps1 -Accept
```

撤销确认：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\packages\core-skill\scripts\confirm_challenge_risk.ps1 -Revoke
```

自定义策略文件：

```powershell
$env:POST_LOAN_CHALLENGE_POLICY = ".\packages\core-skill\references\challenge-policy.example.json"
```

更完整的调研与路线见 `CHALLENGE_ENGINE_RESEARCH.md`。

### 用户自定义策略

系统默认三档是开箱即用策略，高级用户可以按数据源类型或具体数据源覆盖：

- 把某个来源从 `assisted` 改成 `auto`
- 把某个来源从 `auto` 改成 `blocked`
- 为某个来源单独开启/关闭 OCR、会话复用、托管处理

策略文件示例：

```json
{
  "judicial": {
    "mode": "assisted",
    "risk": "high",
    "allowOcr": false,
    "allowSessionReuse": true,
    "allowAssisted": true
  },
  "search:bing": {
    "mode": "assisted",
    "risk": "standard",
    "allowAssisted": true,
    "riskAcknowledged": true
  }
}
```

如果把更安全的默认档位调整为 `auto`，可以在策略文件写入 `riskAcknowledged: true`，也可以使用上面的全局一次确认。系统会把该决策写入审计日志；未确认时会降级为托管或阻断处理。

企业托管部署也可设置 `POST_LOAN_HIGH_RISK_AUTO_ACK=1` 或指定 `POST_LOAN_RISK_CONSENT_FILE`，用于集中化确认和审计。

## 质量规则

- 不把登录页、验证码页、异常页、空白页作为结果页。
- 执行公开网必须确认结果/无结果状态后才截图。
- 搜索引擎必须同一来源前三页完整可用才输出；中途触发验证、登录或异常流量则整组放弃。
- 医院/医疗机构卫健委查询属地优先，属地不可用或无主体结果时切省级。
- 批量查询最终归集 Word 到 `reports`，截图和审计留在 `evidence`。

## 合规边界

本项目用于公开数据源或经授权访问数据源的信息归集和证据留痕。系统默认不绕过登录、验证码或访问控制。司法、政务、强风控门户按托管处理：系统自动打开页面并填好主体，用户在必要时完成登录或验证码，随后系统继续执行。

可选 OCR 只用于合规、授权、低风险场景，不用于规避司法或政务门户的安全校验。
