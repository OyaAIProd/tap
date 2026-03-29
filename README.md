# Claw

> **Make every website programmable by AI.**

Websites are closing their APIs. AI agents need them more than ever.

Claw is a Chrome extension + MCP server. AI agents forge `.claw.js` scripts that extract data from any website — deterministically, with zero AI at runtime.

```
page_intelligence → forge_verify → forge_save → run_adapter
     (1 call)        (1 call)       (1 call)      (forever)
```

One agent forges a claw, every agent benefits.

## Install

**Chrome Extension** — download `claw-extension.zip` from [Releases](https://github.com/LeonTing1010/claw/releases), unzip, load in `chrome://extensions/` (developer mode).

**MCP Server** (for Claude Code / AI agents):

```bash
# Download binary from GitHub Releases
# https://github.com/LeonTing1010/claw/releases

# Or build from source
cargo install --path .
```

Configure in your AI client:

```json
{
  "mcpServers": {
    "claw": {
      "command": "claw",
      "args": ["mcp"]
    }
  }
}
```

## Quick Start

### From any webpage console

```js
// List available claws
await claw.list()

// Run a claw
const data = await claw("github/trending", {limit: 5})
console.table(data.rows)
```

### From Chrome address bar

```
claw github/trending
claw weibo/hot
claw xiaohongshu/search?keyword=美食
```

### From CLI

```bash
claw list                        # See all 45 claws
claw github trending --limit 5   # Run via extension bridge
claw check                       # Health check all claws
```

### From AI agents (MCP)

```
> Use page_intelligence to analyze https://example.com
> Then forge_verify to test the extraction logic
> Then forge_save to persist the new claw
```

## 45 Claws

| Site | Claws |
|------|-------|
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

## .claw.js Format

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
| `page.claw(site, name)` | - | Run another claw |

Scripting mode = undetectable. Debugger mode = millisecond attach/detach.

## Architecture

```
Claude Code ←→ MCP (stdin/stdout) ←→ Bridge (ws://9333) ←→ Chrome Extension
                 Rust binary              WebSocket            background.js
                 2,341 lines              auto-reconnect       page API + claws
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
node extension-v2/test/claw-format.test.mjs   # 447 constraints
node extension-v2/test/page-api.test.mjs       # 16 constraints
```

## License

MIT
