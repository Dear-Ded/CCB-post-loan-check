# 挑战处理引擎技术调研与产品路线

## 调研结论

主流 RPA、浏览器自动化、数据采集框架的成熟做法不是把验证码当成一个孤立 OCR 问题，而是组合能力：

- 浏览器会话与登录态复用：持久 profile、cookie/storage state、账号授权会话续期。
- 挑战识别：识别登录页、验证码页、人机验证页、频控页、WAF/安全网关、空白/错误页。
- 分级处理：低风险授权场景自动处理，司法/政务强风控场景托管处理，禁止自动化或异常风险场景阻断。
- OCR 插件化：字符验证码、算术验证码、内部系统验证码可作为可选能力，默认关闭或按源开启。
- 任务队列与熔断：高频访问触发挑战后冷却、换源、重试失败项，不拖垮整批任务。
- 证据审计：每次挑战识别、决策、截图、失败原因留痕。

## 参考技术路线

- Playwright：推荐用 persistent context / storage state 复用授权会话，使用独立 page/context 隔离来源，避免一个异常页污染其他来源。
- Puppeteer 生态：`puppeteer-extra-plugin-stealth` 等项目说明自动化检测是成熟问题域，但这类反检测路线不应作为默认企业产品能力。
- Robot Framework Browser / TagUI 等 RPA：强调用户托管、可视化流程、任务重试和非技术用户入口。
- OCR 生态：`ddddocr` 等适合普通图片验证码和内部授权系统，需做来源白名单、开关、审计。

## 产品分层

### 第一档：全自动处理

适用范围：

- 普通公开数据源
- 内部系统
- 明确授权系统
- 普通低风险公开源
- 用户拥有账号和权限的业务系统

能力：

- 登录态复用
- 低风险 OCR
- 自动填充、提交、重试
- 结果页校验
- 失败审计

开关：

- `POST_LOAN_ENABLE_LOW_RISK_OCR=1` 默认开启；设置为 `0` 可关闭低风险 OCR
- `POST_LOAN_CHALLENGE_POLICY=path\to\policy.json`

### 第二档：托管处理

适用范围：

- 司法门户
- 政务门户
- 强风控公开源

能力：

- 自动打开页面
- 自动填主体
- 用户完成登录/验证码
- 系统检测结果页并继续跑
- 不把验证码页、登录页、异常页作为结果

### 第三档：阻断处理

适用范围：

- 明确禁止自动化
- 异常风控
- 账号风险
- 搜索引擎频控/验证页

能力：

- 当前源停止
- 记录原因
- 冷却/熔断
- 继续其他源或进入失败重试队列

## 当前实现

- `scripts/framework/challenge_engine.js`
  - 统一挑战决策引擎
  - 支持来源风险、模式、OCR、托管、阻断
- `scripts/framework/challenge_detector.js`
  - 登录、验证码、人机验证、频控、安全网关检测
- `scripts/framework/ocr_solver.js`
  - 可选 OCR 插件
- `scripts/framework/search_manager.js`
  - 搜索引擎挑战识别、冷却、完整三页校验
- `scripts/framework/session_manager.js`
  - 登录态/profile 状态管理
- `scripts/framework/task_queue.js`
  - 批量任务重试和失败隔离

## 不作为默认能力的路线

- 对抗司法/政务强风控的自动验证码绕过。
- 绕过登录、访问控制、账号风险策略。
- 使用第三方打码平台代替用户完成强风控验证。
- 隐匿或伪装自动化访问以规避明确风控。

这些路线即使技术上存在，也不适合作为默认公开产品能力。产品应提供可配置、可审计、来源分级的挑战处理模块，把能力交给合规场景使用。

## 用户自定义配置

三档策略是系统默认值，不是硬编码限制。默认值面向大多数用户体验：普通公开/授权/内部数据源为 `auto`，司法/政务强风控为 `assisted`，异常风控和明确禁止为 `blocked`。高级用户可以通过 `POST_LOAN_CHALLENGE_POLICY` 指向 JSON 策略文件，按数据源类型或具体数据源 ID 覆盖处理档位。

示例：

```json
{
  "government": {
    "mode": "assisted",
    "allowSessionReuse": true
  },
  "search:bing": {
    "mode": "assisted",
    "riskAcknowledged": true
  },
  "internal:erp-captcha": {
    "mode": "auto",
    "risk": "low",
    "allowOcr": true,
    "riskAcknowledged": true
  }
}
```

风险确认规则：

- 从 `auto` 改成 `assisted` 或 `blocked`：直接生效。
- 从 `assisted` / `blocked` 改成 `auto`：必须写入 `riskAcknowledged: true`。
- 桌面产品可通过 `scripts/confirm_challenge_risk.ps1 -Accept` 做全局一次确认并持久记住，不需要逐源确认。
- 桌面产品可通过 `scripts/confirm_challenge_risk.ps1 -Revoke` 撤销全局确认。
- 企业托管部署可通过 `POST_LOAN_HIGH_RISK_AUTO_ACK=1` 或 `POST_LOAN_RISK_CONSENT_FILE` 做集中化确认。
- 未确认风险时：系统不会直接执行自动处理，会降级为托管或阻断，并写入 audit。

这样保持默认安全，同时不限制高级用户在合法授权环境中的部署自由度。
