# Tap

> **Make every interface programmable by AI.**

Tap is a universal protocol for AI to operate any interface. It defines 8 kernel primitives + 16 stdlib operations — the minimal complete set for all human-interface interactions. AI agents forge `.tap.js` scripts once, then any agent runs them deterministically with zero AI at runtime.

```
forge_inspect → forge_verify → forge_save → run_tap
     (1 call)        (1 call)       (1 call)      (forever)
```

One agent forges a tap, every agent benefits.

## Protocol Architecture

Tap follows the **POSIX design philosophy**: minimal kernel, maximal possibility.

```
┌──────────────────────────────────────────────────┐
│ .tap.js scripts (deterministic, zero AI)          │
└──────────────────────┬───────────────────────────┘
┌──────────────────────▼───────────────────────────┐
│ Stdlib — 16 named operations                      │
│ Built on kernel. Runtime may override.            │
│ click, type, hover, scroll, pressKey, select,    │
│ upload, dialog, fetch, find, cookies, download,   │
│ waitFor, waitForNetwork, getSSRState, storage     │
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

A new runtime implements 8 kernel methods, gets 16 stdlib operations for free.

## Install

```bash
# One-line install (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

Then install the Chrome extension:

1. Download `tap-extension.zip` from [Releases](https://github.com/LeonTing1010/tap/releases/latest)
2. Unzip, open `chrome://extensions/`, enable Developer mode
3. Click "Load unpacked" → select the unzipped folder

Configure for AI agents (Claude Code, etc.):

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
const data = await tap("github/trending", {limit: 5})
console.table(data.rows)

await tap.list()  // see all available taps
```

### From Chrome address bar

Type `tap` then Tab:

```
tap github/trending
tap weibo/hot
tap xiaohongshu/search?keyword=美食
```

### From CLI

```bash
tap list                        # See all taps
tap github trending --limit 5   # Run via extension bridge
tap check                       # Health check all taps
```

### From AI agents (MCP)

```
> Use forge.inspect to analyze https://example.com
> Then forge.verify to test the extraction logic
> Then forge.save to persist the new tap
```

## Page API

### Kernel — 8 irreducible primitives

Every runtime must implement these. They are the universal contract.

| Primitive | Description |
|-----------|-------------|
| `page.eval(fn, ...args)` | Execute in target context (the universal escape hatch) |
| `page.pointer(x, y, action)` | Pointer event at coordinates (click/move/down/up) |
| `page.keyboard(key, action, mods?)` | Keyboard event (press/down/up/type) |
| `page.nav(url)` | Navigate to URL |
| `page.wait(ms \| condition)` | Wait for time or condition |
| `page.screenshot()` | Visual capture |
| `page.tap(site, name, args?)` | Composition — call another tap |
| `page.capabilities()` | Declare what this runtime supports |

### Stdlib — 16 named operations

Built on kernel primitives. Runtime may override for native performance.

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
| `page.getSSRState(name?)` | eval | Extract SSR globals |
| `page.storage(type?)` | eval | Read local/session storage |

## .tap.js Format

```js
export default {
  site: "github",
  name: "trending",
  description: "GitHub Trending repositories",
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

## Architecture

```
Claude Code ←→ MCP (stdin/stdout) ←→ Bridge (ws://9333) ←→ Chrome Extension
                 Rust binary              WebSocket            kernel + stdlib
                 gateway (~2,300 lines)   relay                Runtime #1
```

**Rust binary** = gateway between AI agents (MCP) and runtime (extension). No browser logic.
**Chrome extension** = Runtime #1. Implements 8 kernel primitives via chrome.scripting + CDP.
**.tap.js** = deterministic scripts. Zero AI at runtime.

## MCP Tools

| Category | Tools |
|----------|-------|
| **tap.** | `tap.run`, `tap.list`, `tap.screenshot`, `tap.logs` |
| **page.** | `page.click`, `page.type`, `page.nav`, `page.eval`, `page.hover`, `page.scroll`, `page.pressKey`, `page.select`, `page.upload`, `page.find`, `page.cookies`, `page.dialog`, `page.storage`, `page.setCookie` |
| **forge.** | `forge.inspect`, `forge.verify`, `forge.save` |
| **inspect.** | `inspect.page`, `inspect.a11y`, `inspect.dom`, `inspect.element`, `inspect.apiLog`, `inspect.networkStart`, `inspect.networkDump`, `inspect.globals`, `inspect.resources`, `inspect.download` |
| **intercept.** | `intercept.on`, `intercept.off`, `intercept.list`, `intercept.continue`, `intercept.fulfill`, `intercept.fail` |
| **tab.** | `tab.list`, `tab.new`, `tab.close` |

## Building

```bash
cargo build              # Build
cargo test               # 42 tests
cargo clippy             # Lint (0 warnings)

# Extension tests
node extension/test/tap-format.test.mjs   # 790 constraints
node extension/test/protocol.test.mjs     # 81 constraints (kernel + stdlib + delegation)
```

## License

AGPL-3.0 — see [LICENSE](LICENSE). Commercial licensing available.
