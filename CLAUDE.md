# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Make every interface programmable by AI.** Tap is a universal protocol for AI to operate any interface. It defines 8 kernel primitives + 16 stdlib operations that abstract all human-interface interaction. AI agents forge taps (via `page_intelligence` → `forge_verify` → `forge_save`), then any agent can run them with zero AI at runtime.

## Engineering Philosophy

Tap follows the **POSIX design philosophy**: minimal kernel, maximal possibility.

### Protocol = Kernel + Standard Library

```
┌─────────────────────────────────────────────────┐
│ .tap.js scripts (deterministic, zero AI)         │
│ Call stdlib operations: click, type, fetch, ...  │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│ Stdlib — 16 named operations                     │
│ Built on kernel. Runtime may override.           │
│ click, type, hover, scroll, pressKey, select,   │
│ upload, dialog, fetch, find, cookies, download,  │
│ waitFor, waitForNetwork, getSSRState, storage    │
└──────────────────────┬──────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│ Kernel — 8 irreducible primitives                │
│ Every runtime MUST implement these.              │
│ eval, pointer, keyboard, nav, wait,             │
│ screenshot, tap, capabilities                    │
└──────────────────────┬──────────────────────────┘
                       │ Runtime Interface
┌──────────────────────▼──────────────────────────┐
│ Runtime #1: Chrome Extension (current)           │
│ Runtime #N: Android, iOS, Desktop (future)       │
└─────────────────────────────────────────────────┘
```

### Design Principles

1. **Kernel minimality.** Only 8 primitives. A new runtime implements 8 methods, gets 16 stdlib operations for free.
2. **Stdlib composability.** Every stdlib operation is built from kernel calls. `click(target)` = `eval(find)` + `pointer(x, y, 'click')`.
3. **Runtime override.** Stdlib has default implementations, but runtime can override for native performance (e.g., Chrome uses CDP for `upload`, Android uses AccessibilityService for `click`).
4. **Capability negotiation.** Runtime declares what it supports via `capabilities()`. Scripts can declare dependencies via `requires`.
5. **Interface = protocol, not implementation.** The page API is the protocol. The Chrome extension is just the first runtime.
6. **Dependency inversion.** Stdlib depends on kernel interface, not on Chrome APIs. `createStdlib(kernel)` — kernel is injected.

### Key Rules

- **No direct CDP in stdlib.** Stdlib calls kernel primitives. Only kernel touches `chrome.debugger`.
- **No `chrome.scripting` in stdlib.** Use `kernel.eval()` instead.
- **Extension-only for browser.** All browser ops go through extension bridge. Never `--remote-debugging-port`.
- **API > DOM.** `page.fetch()` beats `page.eval(() => querySelectorAll(...))`. Only use DOM when no API exists.

## Architecture

```
Claude Code ←→ MCP (stdin/stdout) ←→ Bridge (ws://9333) ←→ Chrome Extension
                 mcp.rs                 bridge.rs              background.js
                 tool dispatch           WebSocket              routeCDP +
                 + forge tools           auto-reconnect         kernel + stdlib
```

**Rust binary** = thin MCP bridge (~2,200 lines). No direct browser access.
**Chrome extension** = Runtime #1. All browser ops go through it.
**.tap.js** = deterministic scripts using page API (8 kernel + 16 stdlib). Zero AI at runtime.

## Project Structure

```
src/
  main.rs       — CLI: mcp, list, check, completions, <site> <name>
  mcp.rs        — MCP server: ~35 tools over stdin/stdout JSON-RPC
  cdp.rs        — WebSocket JSON-RPC client (bridge transport layer)
  bridge.rs     — WebSocket server on localhost:9333 (extension connects here)
  tap.rs        — .tap.js discovery, metadata extraction, health contracts
  health.rs     — Output validation (min_rows, non_empty columns)
  output.rs     — CLI output formatter (table/json/csv)

extension-v2/
  manifest.json       — Chrome MV3 manifest
  background.js       — Service worker: CDP relay, tap execution, bridge
  runtime/
    executor.js       — Tap loader and runner
    page-api.js       — Kernel (8 primitives) + Stdlib (16 operations)
    page-intelligence.js — One-shot page analysis for forging
  content-script.js   — window.tap() API + tap:// link handler
  results.html/js     — Tap output display page
  taps/               — 45 bundled .tap.js files
    manifest.json     — Auto-generated registry of all taps
  test/               — Format + API contract tests
```

## Best Practices

### Code

- **Kernel purity.** Only kernel (`createKernel`) touches `chrome.scripting`, `chrome.debugger`, `chrome.tabs`. Stdlib calls `kernel.*`.
- **CDP native events for input.** kernel.pointer/keyboard use debugger mode (Input.dispatchMouseEvent/KeyEvent). Never JS `.click()` or `dispatchEvent()`.
- **User-facing = "tap", code uses "tap" internally too.** Brand and code both use "tap" naming.

### Taps (.tap.js)

- **API > DOM. Always.** `page.fetch()` beats `page.eval(() => querySelectorAll(...))`. Only use DOM when no API exists.
- **One tap = one capability.** `github/trending` returns trending repos. `xiaohongshu/publish` publishes a post.
- **`page.tap()` for composition.** If tap A needs data from tap B, call `page.tap("site", "name")`.
- **Health contracts.** Every read tap should have `health: { min_rows: N, non_empty: ["col"] }`.

### Forge Pipeline

```
page_intelligence(url)  → framework, SSR state, APIs, strategy templates
forge_verify(url, expr) → test extraction logic, validate columns
forge_save(site, name)  → persist to ~/.tap/taps/ + extension-v2/taps/
```

## Build & Development

```bash
cargo build              # Build Rust binary
cargo test               # Run all Rust tests (35)
cargo clippy             # Lint
cargo fmt                # Format

# Extension tests
node extension-v2/test/tap-format.test.mjs   # 447 format constraints
node extension-v2/test/page-api.test.mjs     # 16 API contract checks
```

## Verification Gates

| Gate | Command | Checks |
|------|---------|--------|
| typecheck | `cargo check` | Rust compiler |
| lint | `cargo clippy -- -D warnings` | Zero warnings |
| format | `cargo fmt -- --check` | Rustfmt |
| rust tests | `cargo test` | 39 unit tests |
| tap format | `node extension-v2/test/tap-format.test.mjs` | 790 constraints |
| page API | `node extension-v2/test/page-api.test.mjs` | 59 constraints (kernel + stdlib) |

## Test Conventions

Rust: `#[cfg(test)] mod tests` inside each source file. Filter: `cargo test tap::tests`.

Extension: Node.js test scripts in `extension-v2/test/`. Constraint-driven — each test asserts a property that must hold across all taps or the page API.
