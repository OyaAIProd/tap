# Webclaw

> **Make every website programmable by AI.**

Websites are closing their APIs. AI agents need them more than ever.

Webclaw is a Chrome extension + MCP server. AI agents forge `.webclaw.js` scripts that extract data from any website — deterministically, with zero AI at runtime.

```
page_intelligence → forge_verify → forge_save → run_adapter
     (1 call)        (1 call)       (1 call)      (forever)
```

One agent forges a webclaw, every agent benefits.

## Install

**Chrome Extension** — download `webclaw-extension.zip` from [Releases](https://github.com/LeonTing1010/webclaw/releases), unzip, load in `chrome://extensions/` (developer mode).

**MCP Server** (for Claude Code / AI agents):

```bash
# Download binary from GitHub Releases
# https://github.com/LeonTing1010/webclaw/releases

# Or build from source
cargo install --path .
```

Configure in your AI client:

```json
{
  "mcpServers": {
    "webclaw": {
      "command": "webclaw",
      "args": ["mcp"]
    }
  }
}
```

## Quick Start

### From any webpage console

```js
// List available webclaws
await webclaw.list()

// Run a webclaw
const data = await webclaw("github/trending", {limit: 5})
console.table(data.rows)
```

### From Chrome address bar

```
webclaw github/trending
webclaw weibo/hot
webclaw xiaohongshu/search?keyword=美食
```

### From CLI

```bash
webclaw list                        # See all 45 webclaws
webclaw github trending --limit 5   # Run via extension bridge
webclaw check                       # Health check all webclaws
```

### From AI agents (MCP)

```
> Use page_intelligence to analyze https://example.com
> Then forge_verify to test the extraction logic
> Then forge_save to persist the new webclaw
```

## 45 Webclaws

| Site | Webclaws |
|------|----------|
| GitHub | trending |
| Hacker News | hot |
| Reddit | hot |
| Weibo | hot, search |
| Bilibili | hot |
| Xiaohongshu | hot, search, publish, post_detail |
| Zhihu | hot, search |
| Douyin | hot, search |
| YouTube | trending |
| X (Twitter) | trending |
| Product Hunt | hot |
| Stack Overflow | hot |
| V2EX | hot |
| Lobsters | hot |
| Dev.to | top |
| Bluesky | trending |
| Baidu | hot |
| Toutiao | hot |
| Douban | hot |
| 36Kr | hot |
| Juejin | hot |
| SSPAI | hot |
| Xueqiu | hot-stock |
| Wikipedia | most-read |
| Steam | top-sellers |
| CoinGecko | top |
| Crates.io | popular |
| PyPI | top |
| Google | trends |
| Pixiv | ranking |
| Dictionary | search |
| Facebook | feed |
| Instagram | explore |
| TikTok | trending |
| Jimeng | generate, history |
| Telegraph | publish |

## .webclaw.js Format

```js
export default {
  site: "github",
  name: "trending",
  description: "GitHub Trending repositories",
  columns: ["repo", "description", "stars", "language"],
  args: { limit: { type: "int", default: 20 } },
  health: { min_rows: 5, non_empty: ["repo"] },

  async run(page, args) {
    await page.nav("https://github.com/trending")
    await page.waitFor("article.Box-row", 10000)
    await page.wait(2000)

    const items = await page.eval(() => {
      return Array.from(document.querySelectorAll('article.Box-row')).map(el => ({
        repo: el.querySelector('h2 a')?.textContent?.trim().replace(/\s+/g, '') || '',
        description: el.querySelector('p.col-9')?.textContent?.trim() || '',
        stars: el.querySelector('[href$="/stargazers"]')?.textContent?.trim() || '',
        language: el.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim() || ''
      })).filter(item => item.repo.length > 0)
    })

    return items.slice(0, args.limit)
  }
}
```

### Page API (11 methods)

| Method | Mode | Description |
|--------|------|-------------|
| `page.nav(url)` | scripting | Navigate |
| `page.wait(ms)` | scripting | Fixed delay |
| `page.waitFor(sel, ms)` | scripting | Wait for selector |
| `page.eval(fn)` | scripting | Run JS in page context |
| `page.fetch(url)` | scripting | Fetch with page cookies |
| `page.screenshot()` | scripting | Capture visible area |
| `page.cookies()` | scripting | Read cookies |
| `page.click(target)` | debugger | CDP native click |
| `page.type(sel, text)` | debugger | CDP native keyboard |
| `page.upload(sel, files)` | debugger | File upload via CDP |
| `page.webclaw(site, name)` | - | Run another webclaw |

Scripting mode = undetectable. Debugger mode = millisecond attach/detach.

## Architecture

```
Claude Code ←→ MCP (stdin/stdout) ←→ Bridge (ws://9333) ←→ Chrome Extension
                 Rust binary              WebSocket            background.js
                 2,341 lines              auto-reconnect       page API + webclaws
```

Rust binary = thin MCP bridge (6 dependencies). Chrome extension = sole runtime. No direct CDP.

## MCP Tools

| Category | Tools |
|----------|-------|
| **Forge** | `page_intelligence`, `forge_verify`, `forge_save` |
| **Run** | `run_adapter`, `list_adapters` |
| **See** | `screenshot`, `ax_tree`, `read_dom`, `page_info` |
| **Probe** | `find`, `element_info`, `evaluate`, `cookies` |
| **Act** | `click`, `type_text`, `navigate`, `hover`, `scroll`, `press_key` |
| **Inspect** | `api_log`, `global_names`, `resource_tree`, `search_resource`, `request_replay` |
| **Intercept** | `intercept_on/off/list/continue/fulfill/fail`, `set_cookie` |

## Building

```bash
cargo build              # Build
cargo test               # 39 tests
cargo clippy             # Lint (0 warnings)

# Extension tests
node extension-v2/test/webclaw-format.test.mjs   # 447 constraints
node extension-v2/test/page-api.test.mjs          # 16 constraints
```

## License

MIT
