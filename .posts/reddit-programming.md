# Reddit r/programming Post

## Subreddit
r/programming

## Title
Tap: 8 kernel primitives + 17 stdlib operations = a universal protocol for browser automation (no LLM at runtime)

## Body

I built a protocol for browser automation that takes a POSIX-like approach: a tiny kernel of irreducible primitives, with everything else composed on top.

**The kernel (8 primitives):**
```
eval · pointer · keyboard · nav · wait · screenshot · tap · capabilities
```

**The stdlib (17 operations), all composed from kernel calls:**
```
click · type · fill · hover · scroll · pressKey · select
upload · dialog · fetch · find · cookies · download
waitFor · waitForNetwork · ssrState · storage
```

For example, `click(target)` = `eval(find(target))` + `pointer(x, y, 'click')`.

**Why this matters:** a new runtime implements 8 methods and gets 17 operations + every existing script for free. Today there are two runtimes (Chrome Extension via CDP, Playwright). The protocol is platform-agnostic — Android, iOS, desktop could implement the same 8 primitives.

**The twist:** scripts are "forged" by AI. An LLM analyzes the site once, creates a deterministic `.tap.js` file, and that script runs forever with zero AI at runtime. Think of it as "AI-assisted codegen for browser automation" rather than "AI drives the browser."

106 pre-built scripts across 50 sites. ~1,800 lines of Deno, zero dependencies. Works as an MCP server.

AGPL-3.0: https://github.com/LeonTing1010/tap

Curious what this community thinks about the 8-primitive kernel design — is it actually minimal/complete, or are there interactions it can't express?
