<p align="center">
  <img src=".github/logo-woodpecker.svg" width="160" height="160" alt="Tap">
  <h1 align="center">Tap</h1>
  <p align="center"><b>The interface protocol for AI agents</b></p>
  <p align="center"><i>Forge once, run forever — zero AI at runtime</i></p>
</p>

<p align="center">
  <a href="https://github.com/LeonTing1010/tap/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/LeonTing1010/tap/ci.yml?style=flat-square&label=CI" alt="CI"></a>
  <a href="https://github.com/LeonTing1010/tap/releases/latest"><img src="https://img.shields.io/github/v/release/LeonTing1010/tap?style=flat-square" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/LeonTing1010/tap?style=flat-square" alt="License"></a>
  <a href="https://github.com/LeonTing1010/tap/stargazers"><img src="https://img.shields.io/github/stars/LeonTing1010/tap?style=flat-square" alt="Stars"></a>
  <a href="https://github.com/LeonTing1010/tap-skills"><img src="https://img.shields.io/badge/skills-106%20across%2050%20sites-blue?style=flat-square" alt="Skills"></a>
</p>

<p align="center">
  <a href="README.zh-CN.md">中文</a>
</p>

---

AI agents need to operate interfaces — read data, click buttons, fill forms, compose workflows. But AI is too slow, too expensive, and too unreliable to drive every interaction in real-time.

Tap solves this with a new paradigm: **forging.** AI analyzes a site once, creates a deterministic script, and that script runs forever — no AI, no tokens, no hallucinations.

```
forge_inspect → forge_verify → forge_save → tap.run
    AI analyzes      AI tests       AI saves     runs forever, zero AI
```

One agent forges a tap. Every agent benefits.

### Why Tap

| What users care about | How Tap delivers |
|----------------------|-----------------|
| **Will my account get banned?** | Undetectable. Uses Chrome Extensions API (`chrome.scripting`), not debugger protocol. Websites cannot distinguish Tap from a normal browser extension. No yellow "debugging" bar. |
| **Is it accurate?** | Deterministic. Same script, same result, every time. Health contracts (`min_rows`, `non_empty`) catch failures before they reach you. No hallucinations on the 1000th run. |
| **Can it extract any data?** | 8 kernel primitives cover every possible interaction. API-first when possible, DOM fallback when necessary. 106 skills across 50+ sites ready to use. |
| **Does it work beyond the browser?** | 3 runtimes, same protocol: Chrome Extension (your real browser), Playwright (headless), macOS native apps (Accessibility API + CGEvent). Android next. |
| **What does it cost?** | AI tokens once during forge (~$0.50). Then $0.00 forever. |

**106 ready-to-use skills across 50 sites** — X/Twitter, Reddit, GitHub, YouTube, Bilibili, Zhihu, Xiaohongshu, Weibo, Medium, arXiv, and [many more](https://github.com/LeonTing1010/tap-skills). Uses your real Chrome session. No API keys needed.

## The Core Idea

The insight behind Tap: **operating an interface is a solved problem the moment you figure out how.** The hard part is understanding the page — finding the API, locating the right selector, knowing what to click. That's what AI is good at. The easy part is executing the same steps again. That doesn't need AI at all.

So Tap separates the two:

| Phase | Who does it | Cost | Happens |
|-------|------------|------|---------|
| **Forge** | AI agent | Tokens (once) | Once per site |
| **Run** | Deterministic `.tap.js` | $0.00 | Forever |

A forged tap is pure JavaScript. No LLM calls, no prompts, no API keys. It runs in < 1 second, returns structured data, and produces the same result every time.

## The Protocol

Tap defines a minimal, complete contract for operating any interface.

**8 kernel primitives** — the irreducible atoms of all human-interface interaction:

```
eval · pointer · keyboard · nav · wait · screenshot · tap · capabilities
```

**17 stdlib operations** — composed from the kernel, given to every runtime for free:

```
click · type · fill · hover · scroll · pressKey · select · upload · dialog
fetch · find · cookies · download · waitFor · waitForNetwork · ssrState · storage
```

That's it. 8 + 17 = every interaction a human can perform on any interface.

A new runtime implements 8 methods — instantly gains 17 operations and every existing `.tap.js` script. Today it's Chrome and Playwright. Tomorrow: Android, iOS, desktop apps. **Write a tap once, run it on every platform.**

## Install

```bash
# One-line install (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

Then install the Chrome extension:

1. Download `tap-extension.zip` from [Releases](https://github.com/LeonTing1010/tap/releases/latest)
2. Unzip, open `chrome://extensions/`, enable Developer mode
3. Click "Load unpacked" and select the unzipped folder

Connect to your AI agent (Claude Code, Cursor, Windsurf, OpenClaw, etc.):

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
# From source (requires Deno)
git clone https://github.com/LeonTing1010/tap && cd tap
deno compile --allow-all --output tap src/cli.ts

# Via GitHub Packages
npx @LeonTing1010/tap-mcp
```

</details>

Install community skills:

```bash
tap update        # Idempotent: installs skills on first run, updates everything after
```

## Quick Start

### CLI

```bash
tap list                        # See all 106 skills
tap github trending --limit 5   # Get GitHub trending repos
tap zhihu hot                   # Get Zhihu trending topics
```

### AI Agent (MCP)

```
You:  What's trending on GitHub and Hacker News today?
Agent: [calls tap.run("github", "trending") and tap.run("hackernews", "hot")]
       Here are today's top repositories and stories...
```

### Chrome Address Bar

Type `tap` then Tab:

```
tap github/trending
tap weibo/hot
tap xiaohongshu/search?keyword=AI
```

### Web Console

```js
const data = await tap("github/trending", { limit: 5 })
console.table(data.rows)
```

## Forge Pipeline

Any AI agent can create new taps through a 3-step pipeline:

```
forge.inspect(url)      → Detects framework, SSR state, APIs, generates strategy
forge.verify(url, expr) → Tests extraction logic live, validates output
forge.save(site, name)  → Persists .tap.js to disk — done forever
```

**Example:**

```
You: forge.inspect https://news.ycombinator.com
AI:  Found JSON API at /v0/topstories.json, recommends fetch strategy

You: forge.verify https://news.ycombinator.com "fetch('/v0/topstories.json')..."
AI:  Returns 30 rows, columns: [title, score, author, url] ✓

You: forge.save hackernews hot
AI:  Saved to hackernews/hot.tap.js ✓
```

Now `tap hackernews hot` runs forever. No AI. No tokens. No maintenance until the site's API changes.

## Skills

**106 skills across 50 sites** in [tap-skills](https://github.com/LeonTing1010/tap-skills). API-first extraction where possible, DOM fallback when necessary.

### Trending / Hot

| Site | Tap | Strategy |
|------|-----|----------|
| Hacker News | `hackernews/hot` | API |
| Reddit | `reddit/hot` | API |
| GitHub | `github/trending` | DOM |
| Product Hunt | `producthunt/hot` | DOM |
| X / Twitter | `x/trending` | DOM |
| YouTube | `youtube/trending` | DOM |
| Bluesky | `bluesky/trending` | DOM |
| Bilibili | `bilibili/hot` | API |
| Zhihu | `zhihu/hot` | API |
| Weibo | `weibo/hot` | API |
| Xiaohongshu | `xiaohongshu/hot` | SSR |
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

| Site | Tap | Strategy |
|------|-----|----------|
| Reddit | `reddit/search` | API |
| arXiv | `arxiv/search` | API |
| X / Twitter | `x/search` | DOM |
| Medium | `medium/search` | DOM |
| Zhihu | `zhihu/search` | API |
| Weibo | `weibo/search` | API |
| Xiaohongshu | `xiaohongshu/search` | SSR |
| Bilibili | `bilibili/search` | API |
| Douyin | `douyin/search` | API |
| WeChat | `wechat/search` | DOM |
| Dictionary | `dictionary/search` | DOM |

### Deep Read

| Site | Taps |
|------|------|
| Zhihu | `detail`, `comment`, `open` |
| Weibo | `detail`, `comment`, `open` |
| Bilibili | `detail`, `comment`, `open` |
| Xiaohongshu | `detail`, `post_detail`, `comment`, `open` |
| Douyin | `detail`, `comment`, `open` |
| WeChat | `detail`, `open` |
| WeRead | `shelf`, `highlights` |

### Write

| Tap | What it does |
|-----|-------------|
| `x/post` | Post a tweet |
| `weibo/post` | Post on Weibo |
| `xiaohongshu/publish` | Publish a note with images |
| `zhihu/publish` | Publish a Zhihu column article (API) |
| `juejin/publish` | Publish a Juejin article (API) |
| `devto/publish` | Publish a Dev.to article |
| `medium/publish` | Publish a Medium article |
| `telegraph/publish` | Publish a Telegraph article |
| `linkedin/post` | Post on LinkedIn |
| `reddit/post` | Submit a Reddit post |
| `reddit/comment` | Comment on a Reddit post |
| `hackernews/submit` | Submit a story to Hacker News |
| `v2ex/post` | Post a V2EX topic |
| `notion/create` | Create a Notion page |
| `discord/send` | Send a Discord message |
| `slack/send` | Send a Slack message |
| `jimeng/generate` | Generate AI images |

## Architecture

```
                    ┌─ Chrome Extension (kernel via chrome.scripting + CDP)
AI Agent ←→ MCP ←→ Deno Executor ─┤─ Playwright    (kernel via pw API)
  CLI / MCP          load + run     └─ macOS native  (kernel via JXA + CGEvent)
```

**~2,000 lines. Zero dependencies.** The entire system — CLI, MCP server, executor, daemon, three runtimes — in Deno. No frameworks. No build step. No node_modules.

- **Chrome extension** — Runtime #1. Your real browser with real login sessions. Uses Chrome Extensions API (`chrome.scripting`) for undetectable automation, CDP only for input events and CSP fallback.
- **Playwright** — Runtime #2. Headless capable, no extension needed. Server-side automation.
- **macOS** — Runtime #3. Native desktop app automation via Accessibility API, CGEvent, and JXA.
- **.tap.js** — Deterministic scripts. Pure JavaScript, zero AI, runs forever.
- **MCP server** — 43 tools exposing the full protocol to any AI agent.

### .tap.js Format

```js
// API-first: fetch data directly
export default {
  site: "bilibili", name: "hot",
  description: "Bilibili trending videos",
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
// Action: operate the interface via page API
export default {
  site: "x", name: "post",
  description: "Post a tweet",
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

## MCP Tools

43 tools across 6 categories + 3 guided workflow prompts — the full interface protocol exposed as MCP:

| Category | Tools |
|----------|-------|
| **tap.** | `run`, `list`, `screenshot`, `logs`, `reload`, `version` |
| **forge.** | `inspect`, `verify`, `save` |
| **page.** | `click`, `type`, `fill`, `nav`, `eval`, `hover`, `scroll`, `pressKey`, `select`, `upload`, `find`, `cookies`, `dialog`, `storage`, `setCookie` |
| **inspect.** | `page`, `a11y`, `dom`, `element`, `apiLog`, `networkStart`, `networkDump`, `globals`, `resources`, `download` |
| **intercept.** | `on`, `off`, `list`, `continue`, `fulfill`, `fail` |
| **tab.** | `list`, `new`, `close` |

**Prompts** guide agent workflow — invoke with `/mcp__tap__<name>`:

| Prompt | What it does |
|--------|-------------|
| `run` | Check existing taps first → run if found → forge if not. Enforces tap-first execution. |
| `forge` | Step-by-step: inspect → pick strategy → verify → save. |
| `debug` | Diagnose failing tap: check logs → re-inspect → fix → verify → confirm. |

## How Tap Compares

|  | Tap | Inspector Jake | Browser-Use / Stagehand | Playwright / Puppeteer |
|--|-----|---------------|------------------------|----------------------|
| **AI at runtime** | No (forge once) | Yes (every step) | Yes (every step) | No (scripted) |
| **Detection risk** | Undetectable (Extensions API) | Detectable (CDP debugger) | Detectable (CDP) | Detectable (headless) |
| **Cost model** | ~$0.50 once, then $0 | Tokens per session | Tokens per session | Free (manual scripts) |
| **Accuracy** | Deterministic | AI-dependent | AI-dependent | Deterministic |
| **Cross-platform** | Browser + headless + macOS | Browser only | Browser only | Browser only |
| **Reusable artifacts** | .tap.js (shareable) | None (ephemeral) | None (ephemeral) | Test scripts |
| **Composability** | `page.tap()` pipelines | None | None | Limited |
| **Skills ecosystem** | 106 across 50 sites | None | None | None |
| **MCP native** | Yes | Yes | No | No |
| **Self-healing** | Health contracts | None | AI retries | Assertions |

**Tap and Inspector Jake are complementary.** Inspector Jake is a microscope — AI reads the ARIA tree and makes real-time decisions. Tap is a printing press — AI's understanding becomes a permanent, reusable program. Use Inspector Jake to explore, Tap to ship.

## Building

```bash
deno test --no-check --allow-all src/test/       # Unit constraints
node extension/test/architecture.test.mjs        # Architecture constraints
node extension/test/multi-tab.test.mjs           # Multi-tab constraints
node extension/test/tap-format.test.mjs          # Tap format constraints
deno compile --allow-all --output tap src/cli.ts  # Compile binary
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The easiest way to contribute: **forge a new tap.** It's just a `.tap.js` file.

## Roadmap

- [x] **106 community skills** — `tap install` from [tap-skills](https://github.com/LeonTing1010/tap-skills)
- [x] **Playwright runtime** — second kernel, headless capable
- [x] **macOS runtime** — native desktop app automation via Accessibility API + CGEvent
- [x] **One update** — `tap update` pulls core + skills + reloads all connected runtimes
- [ ] **Self-healing taps** — auto re-forge when health contracts detect page changes
- [ ] **Android runtime** — AccessibilityService-based kernel
- [ ] **Tap registry** — publish and discover taps like packages

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=LeonTing1010/tap&type=Date)](https://star-history.com/#LeonTing1010/tap&Date)

## License

AGPL-3.0 — see [LICENSE](LICENSE). Commercial licensing available.
