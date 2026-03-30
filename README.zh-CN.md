<p align="center">
  <img src=".github/logo-woodpecker.svg" width="160" height="160" alt="Tap">
  <h1 align="center">Tap</h1>
  <p align="center"><b>让 AI 可编程操控任何界面</b></p>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/LeonTing1010/tap-skills"><img src="https://img.shields.io/badge/skills-81%20across%2041%20sites-blue?style=flat-square" alt="Skills"></a>
</p>

<p align="center">
  <a href="README.md">English</a>
</p>

Tap 是一个通用协议，让 AI 可以操控任何界面。定义 8 个内核原语，获得 16 个标准库操作，覆盖所有人机交互。AI 一次性锻造 `.tap.js` 脚本 — 之后任何 Agent 都能确定性地运行，运行时零 AI 消耗。

**81 个 skills 覆盖 41 个站点** — Twitter/X、Reddit、GitHub、YouTube、B站、知乎、小红书、微博、Medium、arXiv [等等](https://github.com/LeonTing1010/tap-skills)。复用 Chrome 登录态，无需 API Key。

```
forge_inspect → forge_verify → forge_save → tap.run
    AI 分析         AI 测试        AI 保存      永远运行，零 AI
```

一个 Agent 锻造，所有 Agent 受益。

## 为什么选 Tap

现有的浏览器自动化工具每一步都需要 AI，或者绑定在一种语言、一个运行时上。Tap 采用不同的方式 — **POSIX 的方式**：

| 问题 | Tap 的答案 |
|------|-----------|
| AI 运行时又慢又贵 | **一次锻造，永久运行。** `.tap.js` 是确定性脚本，零 token 消耗 |
| 每个工具都重复实现 click/type/scroll | **8 个内核原语。** 实现 8 个方法，免费获得 16 个标准库操作 |
| 只能自动化浏览器 | **协议，不是实现。** 今天是 Chrome，明天可以是 Android/iOS/桌面 |
| 脚本随网站更新而失效 | **健康契约。** 每个 tap 声明 `min_rows` 和 `non_empty` 列 |
| AI Agent 无法组合工具 | **`page.tap()` 组合。** Tap 可以原生调用其他 tap |

### 对比

| 你的需求 | 最佳工具 | 原因 |
|---------|---------|------|
| AI Agent 的确定性站点操作 | **Tap** | 81 个预置 skills，运行时零 LLM 成本，MCP 原生 |
| 通用 LLM 驱动浏览 | Browser-Use, Stagehand | LLM 每步决策 — 灵活但慢且贵 |
| 大规模爬取 | Crawl4AI, Scrapy | 专为吞吐量和规模构建 |
| 网站 CLI 封装 | OpenCLI | 工具集合模式；Tap 是协议 |
| E2E 测试 | Playwright, Cypress | 测试框架，不是 Agent 协议 |

**Tap 的独特之处：**

- **协议，不是工具集合** — 8 内核 + 16 标准库 = 任何运行时都可实现的通用契约
- **MCP 原生** — 与 Claude Code 及任何 MCP 兼容 Agent 一流集成
- **锻造流程** — AI 通过 inspect/verify/save 创建 tap，然后零 AI 运行
- **合法 Chrome 扩展** — 无 headless 浏览器，无反检测，无指纹伪造
- **可组合** — tap 通过 `page.tap("site", "name")` 调用其他 tap

## 安装

```bash
# 一键安装 (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

然后安装 Chrome 扩展：

1. 从 [Releases](https://github.com/LeonTing1010/tap/releases/latest) 下载 `tap-extension.zip`
2. 解压，打开 `chrome://extensions/`，启用开发者模式
3. 点击"加载已解压的扩展程序" → 选择解压后的文件夹

为 AI Agent 配置（Claude Code、Cursor 等）：

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
```

</details>

安装社区 skills：

```bash
tap install     # 从 tap-skills 仓库克隆 81 个 skills
tap update      # 更新到最新版本
```

## 快速开始

### 在任意网页控制台

```js
const data = await tap("github/trending", { limit: 5 })
console.table(data.rows)

await tap.list()  // 查看所有可用 taps
```

### 从 Chrome 地址栏

输入 `tap` 然后按 Tab：

```
tap github/trending
tap weibo/hot
tap xiaohongshu/search?keyword=AI
```

### 从命令行

```bash
tap list                        # 查看全部 skills
tap github trending --limit 5   # 运行 tap
tap check                       # 健康检查所有 taps
```

### 从 AI Agent（MCP）

```
> 使用 forge.inspect 分析 https://example.com
> 然后 forge.verify 测试提取逻辑
> 然后 forge.save 保存新的 tap
> 现在 tap.run 永远执行，零 AI
```

## Skills

**81 个 skills 覆盖 41 个站点** 在 [tap-skills](https://github.com/LeonTing1010/tap-skills)。优先 API 提取，必要时 DOM 回退。

### 热门 / 趋势

| 站点 | Tap | 模式 |
|------|-----|------|
| Hacker News | `hackernews/hot` | 公开 API |
| Reddit | `reddit/hot` | 公开 API |
| GitHub | `github/trending` | DOM |
| Product Hunt | `producthunt/hot` | DOM |
| X / Twitter | `x/trending` | DOM |
| YouTube | `youtube/trending` | DOM |
| Bluesky | `bluesky/trending` | DOM |
| B站 | `bilibili/hot` | API |
| 知乎 | `zhihu/hot` | API |
| 微博 | `weibo/hot` | API |
| 小红书 | `xiaohongshu/hot` | SSR State |
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

| 站点 | Tap | 模式 |
|------|-----|------|
| Reddit | `reddit/search` | 公开 API |
| arXiv | `arxiv/search` | 公开 API |
| X / Twitter | `x/search` | DOM |
| Medium | `medium/search` | DOM |
| 知乎 | `zhihu/search` | API |
| 微博 | `weibo/search` | API |
| 小红书 | `xiaohongshu/search` | SSR State |
| B站 | `bilibili/search` | API |
| 抖音 | `douyin/search` | API |
| 微信公众号 | `wechat/search` | DOM |
| 词典 | `dictionary/search` | DOM |

### 深度阅读（详情 + 评论）

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
| `reddit/comment` | 评论帖子 |
| `xiaohongshu/publish` | 发布图文笔记 |
| `telegraph/publish` | 发布文章 |
| `jimeng/generate` | 生成 AI 图片 |

### GitHub

| Tap | 功能 |
|-----|------|
| `github/trending` | 热门仓库 |
| `github/issues` | 仓库 Issues（REST API） |
| `github/stars` | 你 Star 的仓库 |

## 锻造流程

AI Agent 通过三步流程创建新的 tap：

```
forge.inspect(url)      → 检测框架、SSR 状态、API，生成策略
forge.verify(url, expr) → 实时测试提取逻辑，验证输出列
forge.save(site, name)  → 保存 .tap.js 到磁盘，更新 manifest
```

**示例：为任意站点锻造新 tap**

```
你：forge.inspect https://news.ycombinator.com
AI：发现 JSON API /v0/topstories.json，推荐 fetch 策略

你：forge.verify https://news.ycombinator.com "fetch('/v0/topstories.json')..."
AI：返回 30 行数据，列：[title, score, author, url] ✓

你：forge.save hackernews hot
AI：已保存至 hackernews/hot.tap.js ✓
```

现在 `tap hackernews hot` 永远运行，零 AI。

## 协议架构

```
┌──────────────────────────────────────────────────┐
│ .tap.js 脚本（确定性，零 AI）                       │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ 标准库 — 16 个命名操作                              │
│ 基于内核构建，运行时可覆写                            │
│ click, type, hover, scroll, pressKey, select,    │
│ upload, dialog, fetch, find, cookies, download,   │
│ waitFor, waitForNetwork, ssrState, storage        │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ 内核 — 8 个不可约原语                               │
│ eval, pointer, keyboard, nav, wait,              │
│ screenshot, tap, capabilities                     │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ 运行时 #1: Chrome 扩展（当前）                       │
│ 运行时 #N: Android, iOS, 桌面（未来）                │
└──────────────────────────────────────────────────┘
```

新的运行时实现 8 个内核方法 — 免费获得全部 16 个标准库操作和所有已有的 `.tap.js`。

### Page API

<details>
<summary>内核 — 8 个原语（点击展开）</summary>

| 原语 | 描述 |
|------|------|
| `page.eval(fn, ...args)` | 在目标上下文执行 |
| `page.pointer(x, y, action)` | 指针事件 |
| `page.keyboard(key, action, mods?)` | 键盘事件 |
| `page.nav(url)` | 导航到 URL |
| `page.wait(ms | condition)` | 等待时间或条件 |
| `page.screenshot()` | 视觉截图 |
| `page.tap(site, name, args?)` | 调用另一个 tap |
| `page.capabilities()` | 查询运行时能力 |

</details>

<details>
<summary>标准库 — 16 个操作（点击展开）</summary>

| 操作 | 构建自 | 描述 |
|------|--------|------|
| `page.click(target)` | eval + pointer | 点击选择器或可见文本 |
| `page.type(sel, text)` | eval + keyboard | 输入文本 |
| `page.hover(sel)` | eval + pointer | 悬停 |
| `page.scroll(sel)` | eval | 滚动到可见 |
| `page.pressKey(key, mods?)` | keyboard | 按键 |
| `page.select(sel, value)` | eval | 下拉选择 |
| `page.upload(sel, files)` | runtime override | 文件上传 |
| `page.dialog(accept?, text?)` | runtime override | 处理弹窗 |
| `page.fetch(url, opts?)` | eval | 带会话 Cookie 的 API 调用 |
| `page.find(query, role?)` | eval | 按可见文本查找元素 |
| `page.cookies()` | runtime override | 读取 Cookie |
| `page.download(url)` | eval | 下载并解析 |
| `page.waitFor(sel, ms?)` | wait | 等待元素出现 |
| `page.waitForNetwork(ms?, idle?)` | eval | 等待网络空闲 |
| `page.ssrState(name?)` | eval | 提取 SSR 全局状态 |
| `page.storage(type?)` | eval | 读取本地/会话存储 |

</details>

### .tap.js 格式

两种形式 — **extract**（读取数据）和 **run**（执行操作）：

```js
// Extract 形式：纯数据提取，API 优先
export default {
  site: "bilibili",
  name: "hot",
  description: "B站热门视频",
  url: "https://www.bilibili.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://api.bilibili.com/x/web-interface/ranking/v2',
      { credentials: 'include' })
    const data = await res.json()
    return data.data.list.map(v => ({
      title: v.title,
      author: v.owner.name,
      views: String(v.stat.view),
      url: 'https://bilibili.com/video/' + v.bvid
    }))
  }
}
```

```js
// Run 形式：通过 page API 执行操作
export default {
  site: "x",
  name: "post",
  description: "发推文",
  columns: ["status", "url"],
  args: { content: { type: "string" } },

  async run(page, args) {
    await page.nav('https://x.com/compose/post')
    await page.wait(2000)
    await page.click('[data-testid="tweetTextarea_0"]')
    await page.type('[data-testid="tweetTextarea_0"]', args.content)
    await page.click('[data-testid="tweetButton"]')
    await page.wait(3000)
    const url = await page.eval(() => location.href)
    return [{ status: 'posted', url }]
  }
}
```

## 架构

```
                    ┌─ Chrome Extension (kernel via CDP)
AI Agent ←→ MCP ←→ Deno Executor ─┤
  CLI / MCP          load + run     └─ Playwright (kernel via pw API)
```

**Deno CLI** — MCP 服务器 + 执行器 + 守护进程（~1,800 行）。零依赖。
**Chrome 扩展** — 运行时 #1。内核提供者，无 tap 执行逻辑。
**Playwright** — 运行时 #2。支持无头模式，无需扩展。
**.tap.js** — 确定性脚本。零 AI，零 token，永久运行。

## MCP 工具

38 个工具按类别组织：

| 类别 | 工具 |
|------|------|
| **tap.** | `run`, `list`, `screenshot`, `logs` |
| **page.** | `click`, `type`, `nav`, `eval`, `hover`, `scroll`, `pressKey`, `select`, `upload`, `find`, `cookies`, `dialog`, `storage`, `setCookie` |
| **forge.** | `inspect`, `verify`, `save` |
| **inspect.** | `page`, `a11y`, `dom`, `element`, `apiLog`, `networkStart`, `networkDump`, `globals`, `resources`, `download` |
| **intercept.** | `on`, `off`, `list`, `continue`, `fulfill`, `fail` |
| **tab.** | `list`, `new`, `close` |

## 构建

```bash
# Deno tests
deno test --no-check --allow-all src/test/     # unit constraints

# Extension constraint tests
node extension/test/tap-format.test.mjs        # format constraints
node extension/test/architecture.test.mjs      # architecture constraints
node extension/test/multi-tab.test.mjs         # multi-tab constraints

# 编译为二进制
deno compile --allow-all --output tap src/cli.ts
```

## 贡献

查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解如何：

- **锻造新 taps** — 最简单的贡献方式（只需一个 `.tap.js` 文件）
- **改进标准库** — 增强 16 个操作
- **实现新运行时** — 把 Tap 带到 Android、iOS 或桌面

## 路线图

- [x] **tap-skills** — 社区 skills 仓库（`tap install`）
- [x] **Playwright 运行时** — 第二个内核，支持无头模式
- [ ] **Android 运行时** — 基于 AccessibilityService 的内核
- [ ] **自动修复** — 检测并重新生成失效的 tap

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)

## 许可证

AGPL-3.0 — 见 [LICENSE](LICENSE)。可提供商业许可。
