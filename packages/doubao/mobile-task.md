# 豆包 App 手机端任务说明

豆包 App 办公任务模式可以作为直接执行入口；当当前账号、端能力或任务环境不支持直接运行时，再交给云端电脑、远程浏览器或企业内 worker。

## 输入

用户可以只输入：

- 单个企业名称
- 多个企业名称，支持换行、逗号、顿号分隔
- 可选统一社会信用代码或组织机构代码
- 可选查询模式：`standard`、`enhanced`、`deep`、`expert`
- 可选法人/实控人个人被执行查询，必须提供 `姓名|身份证号`

不要要求用户描述页面步骤。任务执行器自行判断单家/批量、是否需要卫健委、是否需要司法托管。

## 执行

- 必须调用 `packages/doubao/run_doubao_app.sh`。
- 不得模拟。
- 不得墨迹。
- 不能胡编乱造数据。
- 普通公开源尽量后台执行。
- 不把挑战页、登录页、异常页当作结果。
- 无论直接执行还是后台交接，最终都必须返回 Word、`reports` 文件夹、结果包或下载链接。

## 推荐话术

```text
帮我跑一个 CCB贷前贷后查询，企业名是 XXX，生成 Word，结果发我下载链接。
```

## Ubuntu 办公任务入口

```bash
bash packages/doubao/run_doubao_app.sh --company "企业名" --mode enhanced --json
```

```bash
bash packages/doubao/run_doubao_app.sh --company "企业名" --person "姓名|身份证号" --mode enhanced --json
```

批量任务默认分片执行，每片输出一个 `reports` 文件夹，避免超过后台任务时间。
批量任务不传 `--person`。
