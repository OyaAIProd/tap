# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Make every interface programmable by AI.** Tap is a universal protocol for AI to operate any interface. It defines 8 kernel primitives + 16 stdlib operations that abstract all human-interface interaction. AI agents forge taps (via `forge_inspect` → `forge_verify` → `forge_save`), then any agent can run them with zero AI at runtime.

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
│ Stdlib — 17 named operations                     │
│ Built on kernel. Runtime may override.           │
│ click, type, fill, hover, scroll, pressKey,      │
│ select,                                          │
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
│ Runtime #1: Chrome Extension (chrome.scripting + CDP)│
│ Runtime #2: Playwright (validated 2026-03-30)    │
│ Runtime #3: macOS (JXA + CGEvent + AX API)       │
│ Runtime #N: Android, iOS (future)                │
└─────────────────────────────────────────────────┘
```

### Design Principles

1. **Kernel minimality.** Only 8 primitives. A new runtime implements 8 methods, gets 16 stdlib operations for free.
2. **Stdlib composability.** Every stdlib operation is built from kernel calls. `click(target)` = `eval(find)` + `pointer(x, y, 'click')`.
3. **Runtime override.** Stdlib has default implementations, but runtime can override for native performance (e.g., Chrome uses CDP for `upload`, Android uses AccessibilityService for `click`).
4. **Capability negotiation.** Runtime declares what it supports via `capabilities()`. Scripts can declare dependencies via `requires`.
5. **Interface = protocol, not implementation.** The page API is the protocol. The Chrome extension is just the first runtime.
6. **Dependency inversion.** Stdlib depends on kernel interface, not on Chrome APIs. `createStdlib(kernel)` — kernel is injected.

7. **One update.** `tap update` pulls core + skills + broadcasts reload to all connected runtimes. CLI doesn't know what runtimes exist.

### Key Rules

- **Extensions API first, CDP second.** `chrome.scripting` is undetectable by websites. CDP (`chrome.debugger`) triggers visible debugging state. Only use CDP for: input events (pointer/keyboard), CSP fallback, and performance fast path when debugger is already attached.
- **No direct CDP in stdlib.** Stdlib calls kernel primitives. Only kernel touches `chrome.debugger`.
- **No `chrome.scripting` in stdlib.** Use `kernel.eval()` instead.
- **Composition is local.** `page.tap()` loads sub-taps from disk and runs them in the executor. Never delegates to extension's tap registry. The executor is the only place that knows how to find and run taps. Extension is a runtime, not an executor.
- **Tool layer must not bypass kernel.** `handleTapCommand` (extension tool dispatch) calls `getPage()` kernel methods. Never `routeCDP()`, `chrome.scripting`, or `chrome.debugger` directly.
- **Extension-only for browser.** All browser ops go through extension bridge. Never `--remote-debugging-port`.
- **API > DOM.** `page.fetch()` beats `page.eval(() => querySelectorAll(...))`. Only use DOM when no API exists.

## Architecture

```
                    ┌─ Chrome Extension (chrome.scripting + CDP)
Claude Code ←→ MCP ←→ Deno Executor ─┤─ Playwright (pw API)
  cli.ts / mcp.ts    executor.ts     └─ macOS (JXA + CGEvent)
  tool dispatch       load + run tap
  + forge tools       page proxy → kernel RPC
```

**Deno CLI** = MCP server + CLI + daemon + executor (~2,000 lines). Zero dependencies.
**Deno Executor** = Primary tap executor. Loads .tap.js from disk, runs tap logic locally, routes kernel calls to runtime.
**Chrome Extension** = Runtime #1 (kernel provider). Uses chrome.scripting (undetectable) for eval, CDP only for input events and CSP fallback.
**Playwright** = Runtime #2. `tap --runtime playwright <site> <name>`. Headless capable.
**macOS** = Runtime #3. `tap --runtime macos <site> <name> [--app "App Name"]`. Native desktop apps via Accessibility API. **MCP tools use Chrome extension runtime — macOS taps must run via CLI `--runtime macos`, not through MCP `tap_run`.**
**.tap.js** = deterministic scripts using page API (8 kernel + 17 stdlib). Zero AI at runtime.

### Daemon Architecture

```
Extension (Chrome) ──ws──▶ :9333 (extension port)
CLI / MCP           ──ws──▶ :9334 (client port)
```

Daemon is a dumb WebSocket relay with ID rewriting for multiplexing.
CLI auto-forks the daemon if not running.

## Project Structure

```
src/
  cli.ts                — CLI: list, daemon, mcp, <site> <name> [--runtime]
  mcp.ts                — MCP tools schema (35+ tools)
  daemon.ts             — WebSocket relay (:9333 extension, :9334 clients)
  bridge.ts             — WebSocket client + auto-fork daemon
  executor.ts           — Dynamic .tap.js loader + runner
  page.ts               — Page proxy: 25 methods → RPC to runtime
  runtime-playwright.ts — Playwright kernel (second runtime)
  test/                 — Constraint tests
deno.json               — Deno config (root)

extension/
  manifest.json       — Chrome MV3 manifest
  background.js       — Service worker: kernel provider + bridge (no tap execution)
  protocol/
    protocol.js       — Tap protocol: Kernel (8 primitives) + Stdlib (16 operations)
    forge.js          — One-shot page analysis for tap forging
  tap-client.js       — Page-world client SDK (window.tap() API)
  content-script.js   — tap:// link handler + tap-client injector
  results.html/js     — Tap output display page
  test/               — Architecture + multi-tab + format constraint tests
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
forge.inspect(url)  → framework, SSR state, APIs, strategy templates
forge.verify(url, expr) → test extraction logic, validate columns
forge.save(site, name)  → persist to ~/.tap/taps/ only (user taps, never extension/taps/)
```

## Build & Development

```bash
# Install community skills
deno run --allow-all src/cli.ts install

# Run CLI (default: Chrome Extension runtime)
deno run --allow-all src/cli.ts list
deno run --allow-all src/cli.ts <site> <name> [--arg value]
deno run --allow-all src/cli.ts daemon
deno run --allow-all src/cli.ts mcp

# Run with Playwright runtime (headless capable, no extension needed)
deno run --allow-all src/cli.ts --runtime playwright <site> <name>

# Compile to binary
deno compile --allow-all --output tap src/cli.ts

# Tests
deno test --no-check --allow-all src/test/            # unit constraints
node extension/test/architecture.test.mjs              # architecture constraints
node extension/test/multi-tab.test.mjs                 # multi-tab constraints
```

### Skills Management

```
~/.tap/
  taps/       ← user taps (forge_save, manual). Higher priority.
  skills/     ← community skills (tap update). git clone of tap-skills repo.
```

`tapDirs() = [~/.tap/taps, ~/.tap/skills]` — user taps override skills with same site/name.

## Verification Gates

| Gate | Command | Checks |
|------|---------|--------|
| deno tests | `deno test --no-check --allow-all src/test/` | unit + wire name constraints |
| architecture | `node extension/test/architecture.test.mjs` | kernel purity, click safety, wire names |
| multi-tab | `node extension/test/multi-tab.test.mjs` | tab routing, debugger isolation |
| tap format | `node extension/test/tap-format.test.mjs` | tap file format constraints |

## Test Conventions

Deno: `Deno.test()` in `src/test/`. Classified by `[safety/what]` or `[quality/what]`.

Extension: Node.js test scripts in `extension/test/`. Constraint-driven — each test asserts a property that must hold across all taps or the page API.
