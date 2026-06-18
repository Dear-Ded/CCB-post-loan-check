# 豆包 App 办公任务运行环境适配

## 已知硬指标

| 项目 | 限制 | 项目策略 |
| --- | --- | --- |
| 系统 | Ubuntu 22.04.3 x86_64 | 提供 `bash` 入口，不依赖 PowerShell |
| CPU | 4 核但实际单核 | 串行执行，批量小分片 |
| 内存 | 8GB，单进程 2GB | 单浏览器上下文，任务结束即释放 |
| 磁盘 | 50GB，单文件 500MB | 只输出 Word、截图和 JSON，不打大包 |
| 前台命令 | 120 秒，极限 300 秒 | 单家短任务；批量分片 |
| 后台任务 | 10 分钟 | 默认最多跑 540 秒 |
| 网络 | 100Mbps | 不跑服务，不监听端口 |

## 入口

```bash
bash packages/doubao/preflight_doubao_app.sh
```

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "濮阳豫能综合能源有限公司" \
  --org-code "91410926MACJQ2HCXH" \
  --skip-judicial --skip-search --json
```

## 批量策略

- 默认每片 3 家：`POST_LOAN_BATCH_CHUNK_SIZE=3`
- 默认最长 540 秒：`POST_LOAN_MAX_SECONDS=540`
- 每片都输出 `batch-post-loan-*/reports`
- 未跑完的名单由办公任务模式继续发起下一片

## 不碰的边界

- 不使用 `sudo`
- 不使用 Docker
- 不监听端口
- 不跑常驻服务
- 不依赖 GPU 或本地大模型

