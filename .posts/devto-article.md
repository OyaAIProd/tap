# Dev.to Article

## Title
Why AI-per-step browser automation is fundamentally broken — and what we built instead

## Tags
ai, automation, browser, opensource

## Body (paste as Markdown)

Every AI browser automation tool works the same way:

```
LLM looks at page → decides what to click → clicks → looks again → decides again
```

Every. Single. Step. This is fundamentally broken.

## The numbers don't lie

| Metric | AI-per-step | Tap (forge once) |
|--------|------------|------------------|
| Latency per step | 1-3s (LLM call) | 0ms (no LLM) |
| 10-step workflow | 30+ seconds | < 1 second |
| Cost at 1000 runs/day | $10-100 in tokens | $0.00 |
| Determinism | Non-deterministic | Same result every time |

You're paying AI to do the same thing it already figured out. That's not automation — that's expensive repetition.

## The insight

Operating an interface is a **solved problem the moment you figure out how**.

Finding the API, locating the right selector, knowing what to click — that's the hard part. AI is great at that.

Executing the same steps again? That doesn't need AI at all.

## Tap: separate understanding from execution

Tap is a protocol that separates the two:

```
forge_inspect → forge_verify → forge_save → runs forever
   AI analyzes      AI tests       AI saves     zero AI, $0.00
```

AI runs **once** — analyzes the site, creates a deterministic `.tap.js` script — and that script runs forever. No LLM, no tokens, no hallucinations.

## The protocol: 8 + 17

Tap defines a minimal, complete contract for operating any interface.

**8 kernel primitives** — the irreducible atoms of all human-interface interaction:

```
eval · pointer · keyboard · nav · wait · screenshot · tap · capabilities
```

**17 stdlib operations** — composed from the kernel:

```
click · type · fill · hover · scroll · pressKey · select
upload · dialog · fetch · find · cookies · download
waitFor · waitForNetwork · ssrState · storage
```

Every stdlib operation is built from kernel calls. For example:

```javascript
// click(target) = eval(find) + pointer(x, y, 'click')
// type(selector, text) = click(selector) + keyboard(text)
```

A new runtime implements 8 methods — instantly gains 17 operations and every existing `.tap.js` script.

## What a tap looks like

```javascript
// github/trending.tap.js — runs in < 1 second, returns structured data
export default {
  site: "github",
  name: "trending",
  description: "GitHub trending repositories",

  async run(page) {
    await page.nav("https://github.com/trending");
    return page.eval(() => {
      return [...document.querySelectorAll('article.Box-row')].map(row => ({
        repo: row.querySelector('h2 a')?.textContent?.trim(),
        description: row.querySelector('p')?.textContent?.trim(),
        stars: row.querySelector('[href$="/stargazers"]')?.textContent?.trim(),
        language: row.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim()
      }));
    });
  }
};
```

No LLM. No tokens. Same result every time.

## Two runtimes today, any platform tomorrow

- **Chrome Extension** — uses your real browser session, CDP for kernel
- **Playwright** — headless capable, no extension needed

The protocol is runtime-agnostic. Android, iOS, desktop apps — any platform that implements the 8 kernel primitives gets the full stdlib for free.

## 106 skills across 50 sites

GitHub, Reddit, X/Twitter, YouTube, HN, arXiv, Bilibili, Zhihu, Xiaohongshu, Medium, Dev.to, and [many more](https://github.com/LeonTing1010/tap-skills).

All running deterministically. Zero tokens at runtime. Using your real browser session — no API keys needed.

## It's an MCP server

Tap works as a Model Context Protocol server — plug it into Claude Code, Cursor, Windsurf, or any MCP-compatible AI agent.

```bash
# One-line install
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

~1,800 lines of Deno. Zero dependencies. AGPL-3.0.

**GitHub: [github.com/LeonTing1010/tap](https://github.com/LeonTing1010/tap)**

---

The core question for this community: is "forge once, run forever" the right paradigm for browser automation — or is there value in keeping AI in the loop at every step?
