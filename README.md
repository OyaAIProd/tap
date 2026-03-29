<p align="center">
  <h1 align="center">Tap</h1>
  <p align="center"><b>Make every interface programmable by AI.</b></p>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="#built-in-taps"><img src="https://img.shields.io/badge/taps-77%20across%2040%20sites-blue?style=flat-square" alt="Taps"></a>
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a>
</p>

Tap is a universal protocol for AI to operate any interface. Define 8 kernel primitives, get 16 stdlib operations, cover every human-interface interaction. AI forges `.tap.js` scripts once — then any agent runs them deterministically, zero AI at runtime.

**77 taps across 40 sites** — Twitter/X, Reddit, GitHub, YouTube, Bilibili, Zhihu, Xiaohongshu, Weibo, Medium, arXiv, and [many more](#built-in-taps). Works with your Chrome login session. No API keys needed.

```
forge_inspect → forge_verify → forge_save → tap.run
    AI analyzes      AI tests       AI saves     runs forever, zero AI
```

One agent forges a tap, every agent benefits.

## Why Tap

Existing browser automation tools require AI at every step, or bind to one language, one runtime. Tap takes a different approach — **the POSIX approach**:

| Problem | Tap's Answer |
|---------|-------------|
| AI is slow and expensive at runtime | **Forge once, run forever.** `.tap.js` scripts are deterministic — zero tokens consumed |
| Every tool reimplements click/type/scroll | **8 kernel primitives.** Implement 8 methods, get 16 stdlib ops for free |
| Browser-only automation | **Protocol, not implementation.** Chrome today, Android/iOS/Desktop tomorrow |
| Scripts break when sites change | **Health contracts.** Every tap declares `min_rows` and `non_empty` columns |
| AI agents can't compose tools | **`page.tap()` composition.** Taps call other taps natively |

### How Tap Compares

| Your need | Best tool | Why |
|-----------|-----------|-----|
| Deterministic site operations for AI agents | **Tap** | 77 pre-built taps, zero LLM cost at runtime, MCP native |
| General LLM-driven browsing | Browser-Use, Stagehand | LLM decides each step — flexible but slow and expensive |
| Large-scale crawling | Crawl4AI, Scrapy | Purpose-built for throughput and scale |
| CLI wrapper for websites | OpenCLI | Tool collection approach; Tap is a protocol |
| E2E testing | Playwright, Cypress | Test frameworks, not agent protocols |

**What makes Tap different:**

- **Protocol, not a tool collection** — 8 kernel + 16 stdlib = a universal contract any runtime can implement
- **MCP native** — first-class integration with Claude Code and any MCP-compatible agent
- **Forge pipeline** — AI creates taps through inspect/verify/save, then taps run with zero AI
- **Legitimate Chrome extension** — no headless browser, no anti-detection hacks, no fingerprint spoofing
- **Composable** — taps call other taps via `page.tap("site", "name")`

## Install

```bash
# One-line install (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

Then install the Chrome extension:

1. Download `tap-extension.zip` from [Releases](https://github.com/LeonTing1010/tap/releases/latest)
2. Unzip, open `chrome://extensions/`, enable Developer mode
3. Click "Load unpacked" and select the unzipped folder

Configure for AI agents (Claude Code, Cursor, etc.):

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
<summary>Other install methods</summary>

```bash
# From source
cargo install --git https://github.com/LeonTing1010/tap

# Or build locally
git clone https://github.com/LeonTing1010/tap && cd tap
cargo install --path .

# Windows — download tap-x86_64-pc-windows-msvc.zip from Releases
```

</details>

## Quick Start

### From any webpage console

```js
const data = await tap("github/trending", { limit: 5 })
console.table(data.rows)

await tap.list()  // see all available taps
```

### From Chrome address bar

Type `tap` then Tab:

```
tap github/trending
tap weibo/hot
tap xiaohongshu/search?keyword=AI
```

### From CLI

```bash
tap list                        # See all 77 taps
tap github trending --limit 5   # Run a tap
tap check                       # Health check all taps
```

### From AI agents (MCP)

```
> Use forge.inspect to analyze https://example.com
> Then forge.verify to test the extraction logic
> Then forge.save to persist the new tap
> Now tap.run executes it — forever, zero AI
```

## Built-in Taps

**77 taps across 40 sites.** API-first extraction where possible, DOM fallback when necessary.

### Trending / Hot

| Site | Tap | Mode |
|------|-----|------|
| Hacker News | `hackernews/hot` | Public API |
| Reddit | `reddit/hot` | Public API |
| GitHub | `github/trending` | DOM |
| Product Hunt | `producthunt/hot` | DOM |
| X / Twitter | `x/trending` | DOM |
| YouTube | `youtube/trending` | DOM |
| Bluesky | `bluesky/trending` | DOM |
| Bilibili | `bilibili/hot` | API |
| Zhihu | `zhihu/hot` | API |
| Weibo | `weibo/hot` | API |
| Xiaohongshu | `xiaohongshu/hot` | SSR State |
| Douyin | `douyin/hot` | API |
| V2EX | `v2ex/hot` | DOM |
| Juejin | `juejin/hot` | DOM |
| Lobsters | `lobsters/hot` | DOM |
| Dev.to | `devto/top` | DOM |
| Stack Overflow | `stackoverflow/hot` | DOM |
| Medium | `medium/hot` | DOM |
| 36Kr | `36kr/hot` | DOM |
| Toutiao | `toutiao/hot` | DOM |
| Baidu | `baidu/hot` | DOM |
| SSPai | `sspai/hot` | DOM |
| Douban | `douban/hot` | DOM |
| CoinGecko | `coingecko/top` | DOM |
| Steam | `steam/top-sellers` | DOM |
| Crates.io | `crates/popular` | DOM |
| PyPI | `pypi/top` | DOM |
| Pixiv | `pixiv/ranking` | DOM |
| Wikipedia | `wikipedia/most-read` | DOM |
| Google Trends | `google/trends` | DOM |
| Xueqiu | `xueqiu/hot-stock` | DOM |

### Search

| Site | Tap | Mode |
|------|-----|------|
| Reddit | `reddit/search` | Public API |
| arXiv | `arxiv/search` | Public API |
| X / Twitter | `x/search` | DOM |
| Medium | `medium/search` | DOM |
| Zhihu | `zhihu/search` | API |
| Weibo | `weibo/search` | API |
| Xiaohongshu | `xiaohongshu/search` | SSR State |
| Bilibili | `bilibili/search` | API |
| Douyin | `douyin/search` | API |
| WeChat | `wechat/search` | DOM |
| Dictionary | `dictionary/search` | DOM |

### Deep Read (detail + comments)

| Site | Taps |
|------|------|
| Zhihu | `detail`, `comment`, `open` |
| Weibo | `detail`, `comment`, `open` |
| Bilibili | `detail`, `comment`, `open` |
| Xiaohongshu | `detail`, `post_detail`, `comment`, `open` |
| Douyin | `detail`, `comment`, `open` |
| WeChat | `detail`, `open` |
| WeRead | `shelf`, `highlights` |

### Write / Interact

| Tap | What it does |
|-----|-------------|
| `x/post` | Post a tweet |
| `reddit/comment` | Comment on a post |
| `xiaohongshu/publish` | Publish a note with images |
| `telegraph/publish` | Publish an article |
| `jimeng/generate` | Generate AI images |

### GitHub

| Tap | What it does |
|-----|-------------|
| `github/trending` | Trending repositories |
| `github/issues` | Repository issues (REST API) |
| `github/stars` | Your starred repos |

## Forge Pipeline

AI agents create new taps through a 3-step pipeline:

```
forge.inspect(url)   → Detects framework, SSR state, APIs, generates strategy
forge.verify(url, expr) → Tests extraction logic live, validates output columns
forge.save(site, name)  → Persists .tap.js to disk, updates manifest
```

**Example: forging a new tap for any site**

```
You: forge.inspect https://news.ycombinator.com
AI:  Found JSON API at /v0/topstories.json, recommends fetch strategy

You: forge.verify https://news.ycombinator.com "fetch('/v0/topstories.json')..."
AI:  Returns 30 rows, columns: [title, score, author, url] ✓

You: forge.save hackernews hot
AI:  Saved to hackernews/hot.tap.js ✓
```

Now `tap hackernews hot` runs forever with zero AI.

## Protocol Architecture

```
┌──────────────────────────────────────────────────┐
│ .tap.js scripts (deterministic, zero AI)          │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ Stdlib — 16 named operations                      │
│ Built on kernel. Runtime may override.            │
│ click, type, hover, scroll, pressKey, select,    │
│ upload, dialog, fetch, find, cookies, download,   │
│ waitFor, waitForNetwork, ssrState, storage        │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ Kernel — 8 irreducible primitives                 │
│ eval, pointer, keyboard, nav, wait,              │
│ screenshot, tap, capabilities                     │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ Runtime #1: Chrome Extension (current)            │
│ Runtime #N: Android, iOS, Desktop (future)        │
└──────────────────────────────────────────────────┘
```

A new runtime implements 8 kernel methods — gets all 16 stdlib operations and every existing `.tap.js` for free.

### Page API

<details>
<summary>Kernel — 8 primitives (click to expand)</summary>

| Primitive | Description |
|-----------|-------------|
| `page.eval(fn, ...args)` | Execute in target context |
| `page.pointer(x, y, action)` | Pointer event at coordinates |
| `page.keyboard(key, action, mods?)` | Keyboard event |
| `page.nav(url)` | Navigate to URL |
| `page.wait(ms \| condition)` | Wait for time or condition |
| `page.screenshot()` | Visual capture |
| `page.tap(site, name, args?)` | Call another tap |
| `page.capabilities()` | Query runtime capabilities |

</details>

<details>
<summary>Stdlib — 16 operations (click to expand)</summary>

| Operation | Built from | Description |
|-----------|-----------|-------------|
| `page.click(target)` | eval + pointer | Click by selector or visible text |
| `page.type(sel, text)` | eval + keyboard | Type into an element |
| `page.hover(sel)` | eval + pointer | Hover over element |
| `page.scroll(sel)` | eval | Scroll element into view |
| `page.pressKey(key, mods?)` | keyboard | Single key press |
| `page.select(sel, value)` | eval | Dropdown selection |
| `page.upload(sel, files)` | runtime override | File upload |
| `page.dialog(accept?, text?)` | runtime override | Handle alert/confirm/prompt |
| `page.fetch(url, opts?)` | eval | API call with session cookies |
| `page.find(query, role?)` | eval | Find elements by visible text |
| `page.cookies()` | runtime override | Read cookies |
| `page.download(url)` | eval | Fetch + parse response |
| `page.waitFor(sel, ms?)` | wait | Wait for element to appear |
| `page.waitForNetwork(ms?, idle?)` | eval | Wait for network to settle |
| `page.ssrState(name?)` | eval | Extract SSR globals |
| `page.storage(type?)` | eval | Read local/session storage |

</details>

### .tap.js Format

Two forms — **extract** (read data) and **run** (perform actions):

```js
// Extract form: pure data extraction, API-first
export default {
  site: "bilibili",
  name: "hot",
  description: "Bilibili trending videos",
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
// Run form: actions via page API
export default {
  site: "x",
  name: "post",
  description: "Post a tweet on X/Twitter",
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

## Architecture

```
AI Agent ←→ MCP (stdin/stdout) ←→ Bridge (ws://9333) ←→ Chrome Extension
              Rust binary              WebSocket            Kernel + Stdlib
              ~2,900 lines             auto-reconnect       Runtime #1
```

**Rust binary** — thin MCP gateway. No browser logic, no CDP dependency.
**Chrome extension** — Runtime #1. All browser ops through legitimate extension APIs.
**.tap.js** — deterministic scripts. Zero AI, zero tokens, runs forever.

## MCP Tools

38 tools organized by category:

| Category | Tools |
|----------|-------|
| **tap.** | `run`, `list`, `screenshot`, `logs` |
| **page.** | `click`, `type`, `nav`, `eval`, `hover`, `scroll`, `pressKey`, `select`, `upload`, `find`, `cookies`, `dialog`, `storage`, `setCookie` |
| **forge.** | `inspect`, `verify`, `save` |
| **inspect.** | `page`, `a11y`, `dom`, `element`, `apiLog`, `networkStart`, `networkDump`, `globals`, `resources`, `download` |
| **intercept.** | `on`, `off`, `list`, `continue`, `fulfill`, `fail` |
| **tab.** | `list`, `new`, `close` |

## Building

```bash
cargo build && cargo test     # 47 Rust tests
cargo clippy -- -D warnings   # Zero warnings

# Extension constraint tests
node extension/test/tap-format.test.mjs   # 933 constraints
node extension/test/protocol.test.mjs     # 86 constraints
```

Total: **1,066 automated checks**, zero failures.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to:

- **Forge new taps** — the easiest way to contribute (just a `.tap.js` file)
- **Improve the stdlib** — enhance the 16 operations
- **Implement a new runtime** — bring Tap to Android, iOS, or Desktop

## Roadmap

- [ ] **Tap registry** — community tap discovery and sharing
- [ ] **Android runtime** — AccessibilityService-based kernel
- [ ] **Auto-healing** — detect and regenerate broken taps
- [ ] **Tap composition** — higher-order taps that orchestrate multi-site workflows

## License

AGPL-3.0 — see [LICENSE](LICENSE). Commercial licensing available.
