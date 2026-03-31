# HN Show HN Submission

## Title
Show HN: Tap – A protocol for AI browser automation (forge once, run forever)

## URL
https://github.com/LeonTing1010/tap

## Text (if posting as text instead of link)
Tap is an interface protocol for AI agents. The core idea: AI analyzes a site once, creates a deterministic script (.tap.js), and that script runs forever — no AI, no tokens, no hallucinations at runtime.

The protocol: 8 kernel primitives (eval, pointer, keyboard, nav, wait, screenshot, tap, capabilities) + 16 stdlib operations (click, type, hover, scroll, fetch, etc.). A new runtime implements 8 methods, gets 16 operations free.

Today: Chrome Extension + Playwright runtimes. 81 pre-built skills across 41 sites (GitHub, Reddit, HN, X/Twitter, YouTube, Bilibili, Zhihu, etc.).

It's an MCP server — works with Claude Code, Cursor, Windsurf. ~1,800 lines of Deno. Zero dependencies. AGPL-3.0.

vs. Browser-Use/Stagehand: those tools call the LLM every step ($0.01-0.10/run, 10-30s latency, non-deterministic). Tap costs $0 at runtime, runs in <1s, same result every time.
