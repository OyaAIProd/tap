# 知乎专栏文章

## 标题
8个原语覆盖所有人机交互——Tap协议的设计哲学

## 内容 (Markdown)

AI 浏览器自动化领域正在重复造轮子。Browser-Use、Stagehand、各种 Agent 框架，思路都一样：每一步都让 LLM 来决定。

我做了一个不同的东西：Tap——一个让 AI 只参与一次、脚本永远运行的界面协议。

### 为什么每步都用 AI 是错的

现有工具的工作流：LLM 看页面 → 决定点哪里 → 点击 → 再看 → 再决定。

问题：
- **慢**：每步 LLM 调用 1-3 秒，10步操作 30+ 秒
- **贵**：日跑 1000 次 = 每月几百美元 token 费
- **不确定**：同样的操作，每次结果可能不同
- **脆弱**：AI 会被弹窗、改版搞混

核心洞察：**操作界面这件事，一旦搞清楚怎么做，就是已解决问题。** AI 擅长理解页面，但重复执行不需要 AI。

### Tap 的做法：铸造一次，永远运行

```
forge_inspect → forge_verify → forge_save → 永远运行
   AI 分析        AI 验证        AI 保存     零 AI，零 token
```

### 8 个内核原语

像 POSIX 用 open/close/read/write/fork/exec 抽象操作系统一样，Tap 用 8 个原语抽象所有界面操作：

| 原语 | 作用 |
|------|------|
| eval | 在界面内执行代码 |
| pointer | 鼠标/触摸 |
| keyboard | 键盘输入 |
| nav | 页面导航 |
| wait | 等待条件 |
| screenshot | 截图 |
| tap | 调用其他 tap |
| capabilities | 能力声明 |

### 16 个标准库操作

由内核组合而成：click、type、hover、scroll、pressKey、select、upload、dialog、fetch、find、cookies、download、waitFor、waitForNetwork、ssrState、storage

比如：`click(target) = eval(find) + pointer(x, y, 'click')`

### 为什么 8+16 是完备的

新运行时只需实现 8 个方法，就自动获得 16 个标准库操作 + 所有已有脚本。

目前两个运行时：Chrome 扩展（通过 CDP）和 Playwright（可 headless）。未来：Android、iOS。

### 现状

81 个技能覆盖 41 个站点。~1800 行 Deno，零依赖。作为 MCP server 接入 Claude Code、Cursor 等。

GitHub：github.com/LeonTing1010/tap
