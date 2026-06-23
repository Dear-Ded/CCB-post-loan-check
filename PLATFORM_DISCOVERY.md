# 平台发现与加载方式

## 当前结论

本项目是公开 GitHub 仓库，任何平台都可以通过 URL 抓取：

```text
https://github.com/Dear-Ded/CCB-post-loan-check
```

平台是否能“只通过对话自动加载”，取决于该平台是否支持从 GitHub URL、公开仓库、skill 包或办公任务说明中导入工具。

跨平台统一原则：易搜索、易加载、一句话触发、输出质量稳定可靠。任何平台加载后，都应先读取 `LOAD_THIS_PROJECT.md` 和 `packages/core-skill/references/platform-contract.json`，再选择自己的入口。

项目铁律：不得模拟，不得胡编乱造任何内容；未拿到真实结果页或真实无结果页时，必须返回真实失败原因、补证清单或可重试状态，不得伪装成功。

## Codex

可用方式：

- 直接给 Codex 仓库 URL，让它读取 README、`packages/core-skill/SKILL.md` 和脚本。
- 本地安装时使用 `codex-plugin/skills/post-loan-portal-check` 或 `packages/core-skill`。
- 已安装到本机 Codex skill 后，可通过“贷后查询 / 门户查询 / 企业名”触发。

推荐对话：

```text
加载 https://github.com/Dear-Ded/CCB-post-loan-check 这个项目，并使用 CCB贷前贷后查询 给 XXX 公司生成贷后查询 Word 报告。
```

## WorkBuddy

可用方式：

- 仅 WorkBuddy 电脑版 Windows 入口作为可用运行入口。
- 导入 `packages/core-skill/workbuddy/package-manifest.json`。
- 使用 `packages/core-skill/workbuddy/expert.json` 作为专家配置。
- 入口脚本：`packages/core-skill/workbuddy/run_workbuddy.ps1`。
- WorkBuddy 手机端不要作为运行入口；手机端 Linux 办公任务请使用豆包 App 适配。

推荐对话：

```text
导入 GitHub 项目 https://github.com/Dear-Ded/CCB-post-loan-check，按 WorkBuddy 专家包运行 CCB贷前贷后查询。
```

## 豆包办公任务

可用方式：

- PC 本地任务：调用 `packages/doubao/run_doubao_local.ps1`。
- 云端电脑/远程浏览器任务：读取 `packages/doubao/office-task.md` 和 `packages/doubao/task-mode.json`，在任务工作区复刻同一输出契约。
- 豆包 App 手机端：办公任务模式是 Linux/Ubuntu 环境。直接读取 `packages/doubao/SKILL.md` 和 `packages/doubao/mobile-task.md`，运行 `packages/doubao/run_doubao_app.sh` 并输出 Word、`reports` 或下载链接；不支持时调用 `packages/doubao/run_doubao_mobile.ps1` 交给后台 worker。

推荐对话：

```text
打开并读取 https://github.com/Dear-Ded/CCB-post-loan-check，按 packages/doubao/office-task.md 的要求执行 CCB贷前贷后查询，最终交付 Word 或 reports 文件夹。
```

豆包 App 推荐对话：

```text
帮我加载 https://github.com/Dear-Ded/CCB-post-loan-check 这个项目，按豆包 App 手机端任务说明执行 CCB贷前贷后查询。企业名是 XXX，最后把 Word 或 reports 下载链接发给我。
```

## 搜索关键词

可搜索关键词：

- CCB贷前贷后查询
- 贷前贷后查询
- 贷后门户查询
- 企业贷后查询 Word 报告
- Codex WorkBuddy 豆包 贷后查询
- Chinese enterprise post-loan portal check
- CCB pre post loan query

## 输出契约

- 单家：`贷后查询-{企业名称}-{yyyyMMdd}.docx`
- 批量：`batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/reports`
- 证据：`batch-post-loan-{yyyyMMdd-HHmmss}-{pid}/evidence`
- 验收脚本：`tools/test-output-contract.ps1`
