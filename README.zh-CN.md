<p align="center">
  <img src=".github/logo-woodpecker.svg" width="160" height="160" alt="Tap">
  <h1 align="center">Tap</h1>
  <p align="center"><b>AI Agent 的界面协议</b></p>
  <p align="center"><i>锻造一次，永久运行 — 运行时零 AI</i></p>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/LeonTing1010/tap-skills"><img src="https://img.shields.io/badge/skills-106%20across%2050%20sites-blue?style=flat-square" alt="Skills"></a>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

---

AI Agent 需要操作界面 — 读取数据、点击按钮、填写表单、编排工作流。但让 AI 实时驱动每一次交互太慢、太贵、太不可靠。

Tap 用一个全新范式解决这个问题：**锻造（Forging）。** AI 分析一次站点，创建确定性脚本，之后脚本永久运行 — 不需要 AI、不消耗 token、不会幻觉。

```
forge_inspect → forge_verify → forge_save → tap.run
    AI 分析         AI 测试        AI 保存      永远运行，零 AI
```

一个 Agent 锻造，所有 Agent 受益。

**106 个开箱即用的 skills 覆盖 50 个站点** — X/Twitter、Reddit、GitHub、YouTube、B站、知乎、小红书、微博、Medium、arXiv [等等](https://github.com/LeonTing1010/tap-skills)。复用你真实的 Chrome 登录态，无需 API Key。

## 核心思想

Tap 背后的洞察：**一旦你搞清楚怎么操作一个界面，这个问题就已经被解决了。** 难的部分是理解页面 — 找到 API、定位选择器、知道该点什么。这是 AI 擅长的。简单的部分是重复执行同样的步骤。这完全不需要 AI。

所以 Tap 把两者分开：

| 阶段 | 谁来做 | 成本 | 发生频率 |
|------|--------|------|---------|
| **锻造** | AI Agent | Token（一次性） | 每个站点一次 |
| **运行** | 确定性 `.tap.js` | ¥0 | 永远 |

锻造出的 tap 是纯 JavaScript。没有 LLM 调用，没有 prompt，没有 API key。运行 < 1 秒，返回结构化数据，每次结果一致。

## 协议

Tap 定义了一套最小且完备的界面操作契约。

**8 个内核原语** — 所有人机交互的不可约原子：

```
eval · pointer · keyboard · nav · wait · screenshot · tap · capabilities
```

**17 个标准库操作** — 由内核组合而成，每个运行时免费获得：

```
click · type · fill · hover · scroll · pressKey · select · upload · dialog
fetch · find · cookies · download · waitFor · waitForNetwork · ssrState · storage
```

8 + 17 = 人类在任何界面上能做的所有操作。

新运行时实现 8 个方法 — 立刻获得 17 个操作和所有已有的 `.tap.js` 脚本。今天是 Chrome 和 Playwright，明天是 Android、iOS、桌面应用。**写一次 tap，在所有平台运行。**

## 安装

```bash
# Homebrew (macOS)
brew install LeonTing1010/tap/tap

# 一键安装 (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

然后安装 Chrome 扩展：

1. 从 [Releases](https://github.com/LeonTing1010/tap/releases/latest) 下载 `tap-extension.zip`
2. 解压，打开 `chrome://extensions/`，启用开发者模式
3. 点击「加载已解压的扩展程序」→ 选择解压后的文件夹

连接到你的 AI Agent（Claude Code、Cursor、Windsurf、OpenClaw 等）：

```json
{
  "mcpServers": {
    "tap": {
      "command": "tap",
      "args": ["mcp"]
    }
  }
}
```

<details>
<summary>其他安装方式</summary>

```bash
# 从源码安装（需要 Deno）
git clone https://github.com/LeonTing1010/tap && cd tap
deno compile --allow-all --output tap src/cli.ts

# 通过 GitHub Packages
npx @LeonTing1010/tap-mcp
```

</details>

安装社区 skills：

```bash
tap update        # 幂等：首次运行安装 skills，之后更新一切
```

## 快速开始

### 命令行

```bash
tap list                        # 查看全部 106 个 skills
tap github trending --limit 5   # 获取 GitHub 热门仓库
tap zhihu hot                   # 获取知乎热榜
```

### AI Agent（MCP）

```
你：今天 GitHub 和 Hacker News 上有什么热门？
Agent：[调用 tap.run("github", "trending") 和 tap.run("hackernews", "hot")]
       这是今天最热门的仓库和文章...
```

### Chrome 地址栏

输入 `tap` 然后按 Tab：

```
tap github/trending
tap weibo/hot
tap xiaohongshu/search?keyword=AI
```

### 网页控制台

```js
const data = await tap("github/trending", { limit: 5 })
console.table(data.rows)
```

## 锻造流程

任何 AI Agent 都能通过三步流程创建新的 tap：

```
forge.inspect(url)      → 检测框架、SSR 状态、API，生成策略
forge.verify(url, expr) → 实时测试提取逻辑，验证输出
forge.save(site, name)  → 保存 .tap.js 到磁盘 — 一劳永逸
```

**示例：**

```
你：forge.inspect https://news.ycombinator.com
AI：发现 JSON API /v0/topstories.json，推荐 fetch 策略

你：forge.verify https://news.ycombinator.com "fetch('/v0/topstories.json')..."
AI：返回 30 行数据，列：[title, score, author, url] ✓

你：forge.save hackernews hot
AI：已保存至 hackernews/hot.tap.js ✓
```

现在 `tap hackernews hot` 永久运行。零 AI。零 token。直到站点 API 变更前无需维护。

## Skills

**106 个 skills 覆盖 50 个站点**，详见 [tap-skills](https://github.com/LeonTing1010/tap-skills)。优先 API 提取，必要时 DOM 回退。

### 热门 / 趋势

| 站点 | Tap | 策略 |
|------|-----|------|
| Hacker News | `hackernews/hot` | API |
| Reddit | `reddit/hot` | API |
| GitHub | `github/trending` | DOM |
| Product Hunt | `producthunt/hot` | DOM |
| X / Twitter | `x/trending` | DOM |
| YouTube | `youtube/trending` | DOM |
| Bluesky | `bluesky/trending` | DOM |
| B站 | `bilibili/hot` | API |
| 知乎 | `zhihu/hot` | API |
| 微博 | `weibo/hot` | API |
| 小红书 | `xiaohongshu/hot` | SSR |
| 抖音 | `douyin/hot` | API |
| V2EX | `v2ex/hot` | DOM |
| 掘金 | `juejin/hot` | DOM |
| Lobsters | `lobsters/hot` | DOM |
| Dev.to | `devto/top` | DOM |
| Stack Overflow | `stackoverflow/hot` | DOM |
| Medium | `medium/hot` | DOM |
| 36氪 | `36kr/hot` | DOM |
| 头条 | `toutiao/hot` | DOM |
| 百度 | `baidu/hot` | DOM |
| 少数派 | `sspai/hot` | DOM |
| 豆瓣 | `douban/hot` | DOM |
| CoinGecko | `coingecko/top` | DOM |
| Steam | `steam/top-sellers` | DOM |
| Crates.io | `crates/popular` | DOM |
| PyPI | `pypi/top` | DOM |
| Pixiv | `pixiv/ranking` | DOM |
| Wikipedia | `wikipedia/most-read` | DOM |
| Google Trends | `google/trends` | DOM |
| 雪球 | `xueqiu/hot-stock` | DOM |

### 搜索

| 站点 | Tap | 策略 |
|------|-----|------|
| Reddit | `reddit/search` | API |
| arXiv | `arxiv/search` | API |
| X / Twitter | `x/search` | DOM |
| Medium | `medium/search` | DOM |
| 知乎 | `zhihu/search` | API |
| 微博 | `weibo/search` | API |
| 小红书 | `xiaohongshu/search` | SSR |
| B站 | `bilibili/search` | API |
| 抖音 | `douyin/search` | API |
| 微信公众号 | `wechat/search` | DOM |
| 词典 | `dictionary/search` | DOM |

### 深度阅读

| 站点 | Taps |
|------|------|
| 知乎 | `detail`, `comment`, `open` |
| 微博 | `detail`, `comment`, `open` |
| B站 | `detail`, `comment`, `open` |
| 小红书 | `detail`, `post_detail`, `comment`, `open` |
| 抖音 | `detail`, `comment`, `open` |
| 微信公众号 | `detail`, `open` |
| 微信读书 | `shelf`, `highlights` |

### 写入 / 交互

| Tap | 功能 |
|-----|------|
| `x/post` | 发推文 |
| `weibo/post` | 发微博 |
| `xiaohongshu/publish` | 发布图文笔记 |
| `zhihu/publish` | 发知乎专栏文章（API） |
| `juejin/publish` | 发掘金文章（API） |
| `devto/publish` | 发 Dev.to 文章 |
| `medium/publish` | 发 Medium 文章 |
| `telegraph/publish` | 发 Telegraph 文章 |
| `linkedin/post` | 发 LinkedIn 动态 |
| `reddit/post` | 发 Reddit 帖子 |
| `reddit/comment` | 评论 Reddit 帖子 |
| `hackernews/submit` | 提交 Hacker News 故事 |
| `v2ex/post` | 发 V2EX 主题 |
| `notion/create` | 创建 Notion 页面 |
| `discord/send` | 发 Discord 消息 |
| `slack/send` | 发 Slack 消息 |
| `jimeng/generate` | 生成 AI 图片 |

## 架构

```
                    ┌─ Chrome Extension (kernel via CDP)
AI Agent ←→ MCP ←→ Deno Executor ─┤
  CLI / MCP          load + run     └─ Playwright (kernel via pw API)
```

**~1,800 行代码，零依赖。** 整个系统 — CLI、MCP 服务器、执行器、守护进程、两个运行时 — 不到 2,000 行 Deno 代码。没有框架，没有构建步骤，没有 node_modules。

- **Chrome 扩展** — 运行时 #1。真实浏览器、真实登录态。无 headless 检测，无指纹伪造。
- **Playwright** — 运行时 #2。支持无头模式，无需扩展。服务端自动化。
- **.tap.js** — 确定性脚本。纯 JavaScript，零 AI，永久运行。
- **MCP 服务器** — 40 个工具，将完整协议暴露给任何 AI Agent。

### .tap.js 格式

```js
// API 优先：直接获取数据
export default {
  site: "bilibili", name: "hot",
  description: "B站热门视频",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://api.bilibili.com/x/web-interface/ranking/v2',
      { credentials: 'include' })
    const data = await res.json()
    return data.data.list.map(v => ({
      title: v.title, author: v.owner.name,
      views: String(v.stat.view),
      url: 'https://bilibili.com/video/' + v.bvid
    }))
  }
}
```

```js
// 操作：通过 page API 操控界面
export default {
  site: "x", name: "post",
  description: "发推文",
  args: { content: { type: "string" } },

  async run(page, args) {
    await page.nav('https://x.com/compose/post')
    await page.type('[data-testid="tweetTextarea_0"]', args.content)
    await page.click('[data-testid="tweetButton"]')
    await page.wait(3000)
    return [{ status: 'posted', url: await page.eval(() => location.href) }]
  }
}
```

## MCP 工具

43 个工具覆盖 6 个类别 + 3 个引导工作流的 prompt — 完整的界面协议以 MCP 形式暴露：

| 类别 | 工具 |
|------|------|
| **tap.** | `run`, `list`, `screenshot`, `logs`, `reload`, `version` |
| **forge.** | `inspect`, `verify`, `save` |
| **page.** | `click`, `type`, `fill`, `nav`, `eval`, `hover`, `scroll`, `pressKey`, `select`, `upload`, `find`, `cookies`, `dialog`, `storage`, `setCookie` |
| **inspect.** | `page`, `a11y`, `dom`, `element`, `apiLog`, `networkStart`, `networkDump`, `globals`, `resources`, `download` |
| **intercept.** | `on`, `off`, `list`, `continue`, `fulfill`, `fail` |
| **tab.** | `list`, `new`, `close` |

**Prompts** 引导 Agent 工作流 — 通过 `/mcp__tap__<name>` 调用：

| Prompt | 作用 |
|--------|------|
| `run` | 优先检查已有 tap → 有则运行 → 无则锻造。强制 tap 优先执行。 |
| `forge` | 分步引导：inspect → 选策略 → verify → save。 |
| `debug` | 诊断失败 tap：查日志 → 重新 inspect → 修复 → 验证 → 确认。 |

## 对比

| 你的需求 | 最佳工具 | 原因 |
|---------|---------|------|
| AI Agent 的确定性站点操作 | **Tap** | 106 个预置 skills，运行时零 LLM 成本，MCP 原生 |
| 通用 LLM 驱动浏览 | Browser-Use, Stagehand | LLM 每步决策 — 灵活但慢且贵 |
| 大规模爬取 | Crawl4AI, Scrapy | 专为吞吐量和规模构建 |
| 网站 CLI 封装 | OpenCLI | 工具集合模式；Tap 是协议 |
| E2E 测试 | Playwright, Cypress | 测试框架，不是 Agent 协议 |

## 构建

```bash
deno test --no-check --allow-all src/test/       # 单元约束
node extension/test/architecture.test.mjs        # 架构约束
node extension/test/multi-tab.test.mjs           # 多标签约束
node extension/test/tap-format.test.mjs          # Tap 格式约束
deno compile --allow-all --output tap src/cli.ts  # 编译二进制
```

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。最简单的贡献方式：**锻造一个新 tap。** 只需一个 `.tap.js` 文件。

## 路线图

- [x] **106 个社区 skills** — 从 [tap-skills](https://github.com/LeonTing1010/tap-skills) `tap update`
- [x] **Playwright 运行时** — 第二个内核，支持无头模式
- [x] **macOS 运行时** — 原生桌面应用自动化，Accessibility API + CGEvent
- [x] **统一更新** — `tap update` 拉核心代码 + skills + reload 所有连接的运行时
- [ ] **Android 运行时** — 基于 AccessibilityService 的内核
- [ ] **Tap 注册中心** — 像 npm 包一样发布和发现 tap

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)

## 许可证

AGPL-3.0 — 见 [LICENSE](LICENSE)。可提供商业许可。
