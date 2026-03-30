# tap-mcp

MCP server for [Tap](https://github.com/LeonTing1010/tap) — the universal protocol for AI to operate any interface.

## Setup

GitHub Packages requires auth. Create `~/.npmrc`:

```
@LeonTing1010:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=ghp_YOUR_GITHUB_TOKEN
```

## Quick Start

```json
{
  "mcpServers": {
    "tap": {
      "command": "npx",
      "args": ["-y", "@LeonTing1010/tap-mcp"]
    }
  }
}
```

Works with Claude Code, OpenClaw, Cursor, Windsurf, and any MCP-compatible client.

## What You Get

38 MCP tools across 6 categories:

| Category | Tools | What it does |
|----------|-------|-------------|
| **tap** | list, run, screenshot, logs | Run deterministic .tap.js scripts |
| **forge** | inspect, verify, save | AI creates new taps via forge pipeline |
| **page** | nav, click, type, eval, find, ... | 19 browser operations |
| **inspect** | dom, page, a11y, element, ... | 8 inspection tools |
| **tab** | list, new, close | Multi-tab management |
| **intercept** | on, off, list, continue, ... | Network interception |

## How It Works

```
Your AI Agent → MCP (stdin/stdout) → Tap → Browser
```

Tap's protocol: 8 kernel primitives + 16 stdlib operations. AI forges taps once, then they run deterministically with zero AI at runtime.

## Requirements

- Chrome with [Tap extension](https://github.com/LeonTing1010/tap/tree/master/extension) for browser runtime
- Or use `--runtime playwright` for headless mode (no extension needed)

## Manual Install

If the automatic binary download fails:

```bash
# Option 1: Build from source
deno compile --allow-all --output tap src/cli.ts

# Option 2: Run directly with Deno
deno run --allow-all src/cli.ts mcp
```
