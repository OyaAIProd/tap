# Contributing to Tap

Tap welcomes contributions at every level. Here are three paths, from simplest to most ambitious.

## Path 1: Forge a New Tap (Easiest)

A tap is a single `.tap.js` file. No Rust, no build step.

### With AI (recommended)

If you have the Tap MCP server connected:

```
> forge.inspect https://example.com
> forge.verify https://example.com "your extraction expression"
> forge.save example hot
```

Done. The AI handles framework detection, API discovery, and code generation.

### Manually

1. Create `extension/taps/{site}/{name}.tap.js`
2. Follow one of two forms:

**Extract form** (read data — preferred):

```js
export default {
  site: "mysite",
  name: "hot",
  description: "Trending items from MySite",
  url: "https://mysite.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    // API-first: use fetch() when possible
    const res = await fetch('https://mysite.com/api/trending', { credentials: 'include' })
    const data = await res.json()
    return data.items.map(item => ({
      title: item.title,
      author: item.author,
      url: item.url
    }))
  }
}
```

**Run form** (perform actions):

```js
export default {
  site: "mysite",
  name: "post",
  description: "Post content to MySite",
  columns: ["status", "url"],
  args: { content: { type: "string" } },

  async run(page, args) {
    await page.nav('https://mysite.com/compose')
    await page.type('.editor', args.content)
    await page.click('button.submit')
    await page.wait(3000)
    const url = await page.eval(() => location.href)
    return [{ status: 'posted', url }]
  }
}
```

3. Add the file to `extension/taps/manifest.json` (alphabetical order)
4. Run tests:

```bash
node extension/test/tap-format.test.mjs   # All constraints must pass
```

### Tap Conventions

- **API > DOM.** Always prefer `fetch()` over DOM parsing. Only use DOM when no API exists.
- **One tap = one capability.** `github/trending` returns trending repos. `xiaohongshu/publish` publishes a note.
- **Health contracts.** Every extract tap should have `health: { min_rows: N, non_empty: ["col"] }`.
- **Return strings.** Numeric values should be `String(count)`, not raw numbers.
- **No chrome.\* in taps.** Taps use the page API only. Never `chrome.scripting`, `chrome.debugger`, etc.
- **No args.limit.** The runtime handles limiting — don't add it to your args.
- **Composition.** If tap A needs data from tap B, use `page.tap("site", "name")`.

### Sites We Want

High-value taps the community can help forge:

| Site | Priority Taps | Notes |
|------|--------------|-------|
| LinkedIn | `search` | DOM extraction, requires login |
| Spotify (web) | `search`, `status` | Web player API |
| Substack | `feed`, `search` | Newsletter platform |
| Jike | `feed`, `search`, `post` | Chinese social, has API |
| BOSS Zhipin | `search`, `recommend` | Job platform |
| WeRead | `search`, `ranking` | Expand beyond shelf/highlights |
| Bloomberg | `markets`, `news` | Financial data |
| Hugging Face | `top`, `search` | AI/ML model discovery |

## Path 2: Improve the Stdlib

The stdlib has 16 operations built on 8 kernel primitives. Improvements here benefit every tap and every runtime.

**Where to look:** `extension/protocol/protocol.js` — the `createStdlib(kernel)` function.

**What to improve:**
- Better element resolution in `click()` and `type()` (fuzzy matching, ARIA roles)
- Smarter `waitFor()` with retry strategies
- More robust `ssrState()` for new frameworks (Nuxt, Remix, SvelteKit)
- Performance of `find()` for large DOMs

**Rules:**
- Stdlib calls kernel primitives only. Never `chrome.*` directly.
- Every change must pass `node extension/test/protocol.test.mjs` (86 constraints).
- Default implementations must work across runtimes — don't assume Chrome.

## Path 3: Implement a New Runtime

The most ambitious contribution. A new runtime brings Tap to an entirely new platform.

**What you implement:** 8 kernel methods.

```js
const kernel = {
  eval(fn, ...args) { /* execute fn in target context */ },
  pointer(x, y, action) { /* input event at coordinates */ },
  keyboard(key, action, modifiers) { /* key event */ },
  nav(url) { /* navigate */ },
  wait(ms) { /* delay */ },
  screenshot() { /* capture */ },
  tap(site, name, args) { /* run another tap */ },
  capabilities() { /* declare what this runtime supports */ }
}
```

**What you get for free:** All 16 stdlib operations and all 77+ existing taps.

**Potential runtimes:**

| Runtime | Kernel via |
|---------|-----------|
| Android | AccessibilityService + UIAutomator |
| iOS | XCUITest + Accessibility APIs |
| Desktop (macOS) | AppleScript + Accessibility |
| Desktop (Windows) | UI Automation API |
| Headless | Playwright (for CI/testing) |

Start a discussion in [Issues](https://github.com/LeonTing1010/tap/issues) before implementing a new runtime.

## Development Setup

```bash
git clone https://github.com/LeonTing1010/tap && cd tap

# Rust binary
cargo build
cargo test               # 47 tests
cargo clippy -- -D warnings

# Extension tests
node extension/test/tap-format.test.mjs   # 933 constraints
node extension/test/protocol.test.mjs     # 86 constraints
```

Load the extension from `extension/` directory in Chrome (Developer mode).

## Pull Request Guidelines

- One tap per PR (for new taps) — keeps review fast
- Run all tests before submitting
- Include the site URL and a brief description of your extraction strategy
- For write taps (run form): describe what the tap does and any prerequisites
- Run `cargo clippy -- -D warnings` and `cargo fmt` for Rust changes

## License

Core is AGPL-3.0. Taps (`extension/taps/`) are Apache-2.0.
