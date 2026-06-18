# 加载这个项目

本项目的产品目标是：不管用户换 Codex、WorkBuddy、豆包 App 还是其他办公任务平台，都能做到易搜索、易加载、一句话触发、输出质量稳定可靠。

## 一句话触发

```text
加载 https://github.com/Dear-Ded/CCB- 这个项目，使用 CCB贷前贷后查询，给 XXX 公司生成贷后查询 Word 报告。
```

批量：

```text
加载 https://github.com/Dear-Ded/CCB- 这个项目，使用 CCB贷前贷后查询，给以下企业批量生成贷后查询 Word，最后只给我 reports 文件夹：企业A、企业B、企业C。
```

## 平台优先读取顺序

1. `packages/core-skill/references/platform-contract.json`
2. `packages/core-skill/SKILL.md`
3. `packages/doubao/SKILL.md`
4. `packages/doubao/mobile-task.md`
5. `README.md`

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

## 搜索关键词

- CCB贷前贷后查询
- 贷前贷后查询
- 贷后门户查询
- 企业贷后查询 Word 报告
- Codex WorkBuddy 豆包 贷后查询
- Chinese enterprise post-loan portal check
- CCB pre post loan query
