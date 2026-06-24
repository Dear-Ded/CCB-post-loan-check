# 豆包 App 办公任务运行环境适配

目标环境：Ubuntu 22.04、Node.js、Python 3、浏览器自动化能力、无 root、无服务监听、单进程 2GB 内存、后台任务约 10 分钟。

## 入口

```bash
bash packages/doubao/run_doubao_app.sh \
  --company "企业名" \
  --org-code "统一社会信用代码或组织机构代码" \
  --person "姓名|身份证号" \
  --mode enhanced \
  --json
```

`--person` 只用于单家企业任务，且必须来自用户提供的真实姓名和身份证号。批量任务不要传该参数。

## 策略

- 前台命令保持轻量，长任务交给后台任务窗口。
- 批量任务按 `POST_LOAN_BATCH_CHUNK_SIZE` 分片。
- 输出必须是 Word、`reports` 文件夹或下载链接。
- 会话和临时文件保留在当前任务机器本地，不上传到项目仓库。
- 不得模拟、不得编造、不得生成样例报告。
