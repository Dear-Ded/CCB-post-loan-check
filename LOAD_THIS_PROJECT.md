# 加载这个项目

本项目的产品目标是：不管用户换 Codex、WorkBuddy、豆包 App 还是其他办公任务平台，都能做到易搜索、易加载、一句话触发、输出质量稳定可靠。

## 项目铁律

- 不得模拟任何查询结果、截图、报告、证据或数据。
- 不得胡编乱造任何内容，包括企业信息、司法/执行结果、身份证号、来源链接、截图状态和失败原因。
- 未拿到真实结果页或真实无结果页时，必须返回真实失败原因、补证清单或可重试状态，不得伪装成功。
- 所有平台适配都必须原原本本执行项目脚本，不得用演示报告、样例截图、缓存想象结果替代真实查询。

## 一句话触发

```text
加载 https://github.com/Dear-Ded/CCB-post-loan-check 这个项目，使用 CCB贷前贷后查询，给 XXX 公司生成贷后查询 Word 报告。
```

极速模式：

```text
加载 https://github.com/Dear-Ded/CCB-post-loan-check 这个项目，先执行 npm run mode:fast 开启一键极速模式，然后给 XXX 公司生成贷后查询 Word 报告。
```

批量：

```text
加载 https://github.com/Dear-Ded/CCB-post-loan-check 这个项目，使用 CCB贷前贷后查询，给以下企业批量生成贷后查询 Word，最后只给我 reports 文件夹：企业A、企业B、企业C。
```

## 平台优先读取顺序

1. `packages/core-skill/references/platform-contract.json`
2. `packages/core-skill/SKILL.md`
3. `packages/doubao/SKILL.md`
4. `packages/doubao/mobile-task.md`
5. `README.md`

## 平台入口路由

- Codex：读取 `packages/core-skill/SKILL.md` 或 `codex-plugin/skills/post-loan-portal-check/SKILL.md`，使用核心 PowerShell 入口。
- WorkBuddy：只有电脑版 Windows 入口可正常运行，导入 `packages/core-skill/workbuddy/package-manifest.json`，调用 `workbuddy/run_workbuddy.ps1`；不要向 WorkBuddy 手机端暴露 Linux/bash 入口。
- 豆包 App 手机端：办公任务模式是 Linux/Ubuntu 环境，读取 `packages/doubao/SKILL.md` 和 `packages/doubao/mobile-task.md`，调用 `packages/doubao/run_doubao_app.sh`。
- 豆包 PC/云端办公任务：读取 `packages/doubao/office-task.md` 和 `packages/doubao/task-mode.json`，输出合同与手机端一致。

## 依赖安装

Linux / 豆包 App 办公任务模式：

```bash
npm install
python3 -m pip install -r requirements.txt --user
bash packages/doubao/preflight_doubao_app.sh
```

如果平台已经预装 Playwright、Pillow、lxml，可直接执行预检。

## 统一输出

- 单家：`贷后查询-{企业名称}-{yyyyMMdd}.docx`
- 批量：`batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/reports`
- 证据：`batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/evidence`
- 验收：`tools/test-output-contract.ps1`
- 官方源预检：`npm run diagnose:official -- --company "企业名称"`

## 搜索关键词

- CCB贷前贷后查询
- 贷前贷后查询
- 贷后门户查询
- 企业贷后查询 Word 报告
- Codex WorkBuddy 豆包 贷后查询
- Chinese enterprise post-loan portal check
- CCB pre post loan query
