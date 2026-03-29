# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Make every website programmable by AI.** Claw is a Chrome extension + MCP server that turns websites into deterministic .claw.js scripts. AI agents forge claws (via `page_intelligence` → `forge_verify` → `forge_save`), then any agent can run them with zero AI at runtime.

## Architecture (v2 — Extension-Only)

```
Claude Code ←→ MCP (stdin/stdout) ←→ Bridge (ws://9333) ←→ Chrome Extension
                 mcp.rs                 bridge.rs              background.js
                 tool dispatch           WebSocket              routeCDP +
                 + forge tools           auto-reconnect         page API
```

**Rust binary** = thin MCP bridge (~2,200 lines). No direct browser access.
**Chrome extension** = sole runtime. All browser ops go through it.
**.claw.js** = deterministic scripts using 11 page API methods. Zero AI at runtime.

### Key Principle

**No direct CDP.** Never fall back to `--remote-debugging-port`. If extension not connected, wait or error. All browser operations go through the extension bridge.

## Project Structure

```
src/
  main.rs       — CLI: mcp, list, check, completions, <site> <name>
  mcp.rs        — MCP server: ~35 tools over stdin/stdout JSON-RPC
  cdp.rs        — WebSocket JSON-RPC client (bridge transport layer)
  bridge.rs     — WebSocket server on localhost:9333 (extension connects here)
  adapter.rs    — .claw.js discovery, metadata extraction, health contracts
  health.rs     — Output validation (min_rows, non_empty columns)
  output.rs     — CLI output formatter (table/json/csv)

extension-v2/
  manifest.json       — Chrome MV3 manifest
  background.js       — Service worker: CDP relay, claw execution, bridge
  runtime/
    executor.js       — Claw loader and runner
    page-api.js       — 11 page API methods (the claw instruction set)
    page-intelligence.js — One-shot page analysis for forging
  content-script.js   — window.claw() API + claw:// link handler
  results.html/js     — Claw output display page
  claws/              — 45 bundled .claw.js files
    manifest.json     — Auto-generated registry of all claws
  test/               — Format + API contract tests
```

## Best Practices

### Code

- **Extension-only.** All browser ops through extension bridge. Never `browser::connect_browser()` or Chrome launch logic.
- **CDP native events for input.** page.click/type/upload use debugger mode (Input.dispatchMouseEvent/KeyEvent). Never JS `.click()` or `dispatchEvent()`.
- **User-facing = "claw", code = "adapter".** Brand name is "claw". Internal code keeps `adapter` naming to avoid massive rename.

### Claws (.claw.js)

- **API > DOM. Always.** `page.fetch()` beats `page.eval(() => querySelectorAll(...))`. Only use DOM when no API exists.
- **One claw = one capability.** `github/trending` returns trending repos. `xiaohongshu/publish` publishes a post.
- **`page.claw()` for composition.** If claw A needs data from claw B, call `page.claw("site", "name")`.
- **Health contracts.** Every read claw should have `health: { min_rows: N, non_empty: ["col"] }`.

### Forge Pipeline

```
page_intelligence(url)  → framework, SSR state, APIs, strategy templates
forge_verify(url, expr) → test extraction logic, validate columns
forge_save(site, name)  → persist to ~/.claw/claws/ + extension-v2/claws/
```

## Build & Development

```bash
cargo build              # Build Rust binary
cargo test               # Run all Rust tests (35)
cargo clippy             # Lint
cargo fmt                # Format

# Extension tests
node extension-v2/test/claw-format.test.mjs   # 447 format constraints
node extension-v2/test/page-api.test.mjs       # 16 API contract checks
```

## Verification Gates

| Gate | Command | Checks |
|------|---------|--------|
| typecheck | `cargo check` | Rust compiler |
| lint | `cargo clippy -- -D warnings` | Zero warnings |
| format | `cargo fmt -- --check` | Rustfmt |
| rust tests | `cargo test` | 35 unit tests |
| claw format | `node extension-v2/test/claw-format.test.mjs` | 447 constraints |
| page API | `node extension-v2/test/page-api.test.mjs` | 16 constraints |

## Test Conventions

Rust: `#[cfg(test)] mod tests` inside each source file. Filter: `cargo test adapter::tests`.

Extension: Node.js test scripts in `extension-v2/test/`. Constraint-driven — each test asserts a property that must hold across all claws or the page API.
