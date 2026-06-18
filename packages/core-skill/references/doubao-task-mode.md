# 豆包任务模式适配设计

## 模式理解

豆包任务模式可被视为一个带浏览器能力的可视化任务执行环境：

- PC 客户端场景下，任务可操作本地浏览器。
- Web 端场景下，任务可操作远程虚拟浏览器。
- 手机端用户也可以发起任务，由云端/远程环境完成网页操作。

这意味着适配重点不是本机 PowerShell，而是把流程描述成稳定的浏览器任务状态机。

## 状态机

1. 收集企业信息。
2. 启动浏览器会话。
3. 打开需要人工登录/验证码的页面。
4. 一次性提示用户：
   - 登录裁判文书网。
   - 执行公开网如需登录则登录。
   - 对每个执行公开网查询页输入验证码。
5. 等待页面进入可查询状态。
6. 自动填充企业名、统一社会信用代码或个人身份证号。
7. 点击查询。
8. 如果验证码错误、页面无响应、查询页加载失败，则保持当前页并等待用户重新输入验证码。
9. 只在确认查询结果/无结果状态后截图。
10. 汇总截图并生成报告。

## 截图验收

执行公开网截图必须满足：

- URL 属于 `zxgk.court.gov.cn`。
- 页面不是登录页、验证码错误页、异常页或空白页。
- 页面文本出现查询结果、未查询到、暂无数据、执行法院、案号、立案时间、执行标的等结果态信号之一。

不满足时不得进入最终 Word。

## Public References

- Doubao privacy policy: https://www.doubao.com/legal/privacy
- Doubao browser extension landing page: https://www.doubao.com/browser-extension/landing

The adapter treats task-mode browser sessions as user-supervised browser automation. User login, cookie persistence, and security verification remain under user control.

