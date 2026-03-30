---
name: tap
description: "AI browser automation protocol — forge deterministic scripts from any site, then run forever with zero AI. 81 pre-built skills across 41 sites, MCP native."
version: 0.1.0
metadata:
  openclaw:
    requires:
      bins:
        - tap
    install:
      - kind: brew
        formula: LeonTing1010/tap/tap
        bins: [tap]
    emoji: "🪶"
    homepage: https://github.com/LeonTing1010/tap
---

# Tap — The Interface Protocol for AI Agents

Tap gives you deterministic browser automation. Instead of burning tokens on every click, **forge a script once and run it forever — zero AI at runtime.**

## How It Works

Tap exposes 38 MCP tools in 6 categories:

### Run Pre-Built Skills (zero AI, instant results)

Use `tap.list` to see all 81 available skills, then `tap.run` to execute:

```
tap.run({ site: "github", name: "trending" })        → trending repos
tap.run({ site: "hackernews", name: "hot" })          → top HN stories
tap.run({ site: "zhihu", name: "hot" })               → Zhihu trending
tap.run({ site: "xiaohongshu", name: "search", args: { keyword: "AI" } })
```

These run in < 1 second, cost $0, and return structured data every time.

**81 skills across 41 sites**: X/Twitter, Reddit, GitHub, YouTube, Bilibili, Zhihu, Xiaohongshu, Weibo, Medium, arXiv, Hacker News, Product Hunt, Bluesky, Steam, CoinGecko, and more.

### Forge New Skills (AI creates, then never needed again)

When you need a site that doesn't have a pre-built skill:

1. **Inspect** — `forge.inspect({ url: "https://example.com" })` analyzes the page: framework, SSR state, APIs, extraction strategies
2. **Verify** — `forge.verify({ url: "...", expression: "fetch('/api/data')..." })` tests the extraction logic live
3. **Save** — `forge.save({ site: "example", name: "data", code: "..." })` persists the script

After saving, `tap.run({ site: "example", name: "data" })` works forever. No AI needed.

### Direct Browser Control

Full browser operation via the page API — use when you need one-off interactions:

- `page.nav({ url })` — navigate
- `page.click({ target })` — click by selector or visible text
- `page.type({ selector, text })` — type into elements
- `page.eval({ expression })` — execute JavaScript
- `page.fetch({ url })` — API call with session cookies
- `page.find({ query })` — find elements by text
- `page.screenshot()` — capture the page
- `page.scroll`, `page.hover`, `page.pressKey`, `page.select`, `page.upload`

### Inspect & Debug

- `inspect.dom` — full DOM structure
- `inspect.a11y` — accessibility tree
- `inspect.page` — page metadata and state
- `inspect.apiLog` / `inspect.networkDump` — network activity
- `inspect.resources` — loaded resources

### Tab Management

- `tab.list` — all open tabs
- `tab.new({ url })` — open new tab
- `tab.close({ tabId })` — close tab

### Network Interception

- `intercept.on({ pattern })` — start intercepting requests
- `intercept.fulfill({ requestId, body })` — mock responses
- `intercept.continue` / `intercept.fail` — pass through or block

## Setup

### 1. Install Tap

```bash
curl -fsSL https://raw.githubusercontent.com/LeonTing1010/tap/master/install.sh | sh
```

### 2. Install Chrome Extension

Download `tap-extension.zip` from the [latest release](https://github.com/LeonTing1010/tap/releases/latest), unzip, load as unpacked extension in `chrome://extensions/`.

### 3. Install Community Skills (optional)

```bash
tap install    # 81 skills across 41 sites
```

### 4. Add MCP Server

Add to your OpenClaw MCP configuration:

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

## Common Workflows

### Research: aggregate trending across platforms

```
1. tap.run github/trending
2. tap.run hackernews/hot
3. tap.run reddit/hot
→ Cross-reference results for emerging topics
```

### Monitor: track topics across sites

```
1. tap.run x/search { keyword: "AI agents" }
2. tap.run zhihu/search { keyword: "AI agents" }
3. tap.run xiaohongshu/search { keyword: "AI agents" }
→ Compare discussion across platforms
```

### Publish: cross-post content

```
1. tap.run x/post { content: "..." }
2. tap.run xiaohongshu/publish { title: "...", content: "..." }
3. tap.run telegraph/publish { title: "...", content: "..." }
```

### Forge: create a skill for any new site

```
1. forge.inspect { url: "https://newsite.com" }
2. forge.verify { url: "...", expression: "..." }
3. forge.save { site: "newsite", name: "data" }
4. tap.run newsite/data  ← works forever, zero AI
```

## Key Advantage

Other browser skills tell AI how to operate a site step-by-step — every run costs tokens and can fail.

Tap skills are **deterministic scripts** — forged once by AI, then run forever with zero AI. The 81 pre-built skills cover the most common sites. For anything else, use the forge pipeline to create new skills on the fly.
