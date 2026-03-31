# X/Twitter Thread: Why AI-per-step browser automation is broken

## Tweet 1 (hook)
Every AI browser automation tool works the same way:

LLM looks at page → decides what to click → clicks → looks again → decides again

Every. Single. Step.

This is fundamentally broken. Here's why 🧵

## Tweet 2 (problem)
The numbers don't lie:

- Each LLM step: 1-3 seconds
- 10-step workflow: 30+ seconds
- Running 1000x/day: $10-100 in tokens
- Determinism: zero

You're paying AI to do the same thing it already figured out. That's not automation — that's expensive repetition.

## Tweet 3 (insight)
The insight: operating an interface is a SOLVED PROBLEM the moment you figure out how.

Finding the API, locating selectors, knowing what to click — that's the hard part. AI is great at that.

Executing the same steps again? That doesn't need AI at all.

## Tweet 4 (solution)
So we built Tap: a protocol that separates understanding from execution.

AI runs ONCE → analyzes the site → creates a deterministic script → that script runs FOREVER

forge_inspect → forge_verify → forge_save → run forever
                                              zero AI, $0.00

## Tweet 5 (protocol)
The protocol: 8 kernel primitives + 16 stdlib operations = every interaction a human can perform.

8 primitives: eval · pointer · keyboard · nav · wait · screenshot · tap · capabilities

New runtime implements 8 methods → gets 16 operations free.
Chrome today. Android tomorrow.

## Tweet 6 (numbers)
81 skills across 41 sites, ready to use.

GitHub, Reddit, HN, X, YouTube, Bilibili, Zhihu, Xiaohongshu, Medium, arXiv...

All running deterministically. Zero tokens at runtime.

~1,800 lines of Deno. Zero dependencies.

## Tweet 7 (CTA)
Tap is open source (AGPL-3.0).

It's an MCP server — works with Claude Code, Cursor, Windsurf, any AI agent.

GitHub: github.com/LeonTing1010/tap

Forge once, run forever.
