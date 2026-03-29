//! MCP (Model Context Protocol) server implementation.
//!
//! Exposes tap's forge toolkit as MCP tools over stdin/stdout JSON-RPC.
//! This lets AI agents (Claude Code, etc.) use tap's tools natively.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::bridge::BridgeServer;
use crate::cdp::BridgeClient;
use crate::tap::{tap_home, tap_cache, tap_log, tap_log_read};

/// Run the MCP server: read JSON-RPC from stdin, write responses to stdout.
pub async fn serve() -> Result<(), Box<dyn std::error::Error>> {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin);

    // Start bridge server immediately — extension can connect anytime
    let bridge = BridgeServer::start();

    loop {
        let mut line = String::new();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break; // EOF
        }
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let request: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                let err_resp = json!({
                    "jsonrpc": "2.0",
                    "id": null,
                    "error": { "code": -32700, "message": format!("parse error: {}", e) }
                });
                write_response(&mut stdout, &err_resp).await?;
                continue;
            }
        };

        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request["method"].as_str().unwrap_or("");

        let response = match method {
            "initialize" => handle_initialize(&id),
            "notifications/initialized" => continue, // no response needed
            "tools/list" => handle_tools_list(&id),
            "resources/list" | "prompts/list" => json!({
                "jsonrpc": "2.0", "id": id, "result": {}
            }),
            "tools/call" => {
                // Wait for extension bridge — poll up to 30s
                let client = match bridge.get_client().await {
                    Some(c) => c,
                    None => {
                        eprintln!("mcp: waiting for Chrome extension...");
                        let mut client_opt = None;
                        for _ in 0..30 {
                            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            if let Some(c) = bridge.get_client().await {
                                eprintln!("mcp: connected via Chrome extension bridge");
                                client_opt = Some(c);
                                break;
                            }
                        }
                        match client_opt {
                            Some(c) => c,
                            None => {
                                let err_resp = json!({
                                    "jsonrpc": "2.0",
                                    "id": id,
                                    "result": {
                                        "content": [{"type": "text", "text": "error: Chrome extension not connected. Install Tap extension and reload it."}],
                                        "isError": true
                                    }
                                });
                                write_response(&mut stdout, &err_resp).await?;
                                continue;
                            }
                        }
                    }
                };
                handle_tool_call(&id, &request["params"], &client).await
            }
            _ => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": { "code": -32601, "message": format!("method not found: {}", method) }
            }),
        };

        write_response(&mut stdout, &response).await?;
    }

    Ok(())
}

/// Regenerate extension/taps/manifest.json from the directory contents.
fn update_taps_manifest() -> Result<(), Box<dyn std::error::Error>> {
    let taps_dir = std::path::Path::new("extension/taps");
    let mut files = Vec::new();
    for site_entry in std::fs::read_dir(taps_dir)?.flatten() {
        if !site_entry.path().is_dir() {
            continue;
        }
        let site = site_entry.file_name().to_string_lossy().to_string();
        for file_entry in std::fs::read_dir(site_entry.path())?.flatten() {
            let name = file_entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".tap.js") {
                files.push(format!("{}/{}", site, name));
            }
        }
    }
    files.sort();
    let json = serde_json::to_string_pretty(&files)?;
    std::fs::write(taps_dir.join("manifest.json"), format!("{}\n", json))?;
    Ok(())
}

async fn write_response(
    stdout: &mut tokio::io::Stdout,
    response: &Value,
) -> Result<(), Box<dyn std::error::Error>> {
    let s = serde_json::to_string(response)?;
    stdout.write_all(s.as_bytes()).await?;
    stdout.write_all(b"\n").await?;
    stdout.flush().await?;
    Ok(())
}

/// Tap protocol version. Must match PROTOCOL_VERSION in protocol.js.
const TAP_PROTOCOL_VERSION: &str = "1.0.0";

fn handle_initialize(id: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {},
                "resources": {},
                "prompts": {}
            },
            "serverInfo": {
                "name": "tap",
                "version": env!("CARGO_PKG_VERSION"),
                "tapProtocol": TAP_PROTOCOL_VERSION
            }
        }
    })
}

fn handle_tools_list(id: &Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "tools": tools_schema()
        }
    })
}

// ============================================================================
// RESOURCES — tap:// URI scheme for protocol introspection
// ============================================================================

#[allow(dead_code)] // called via string dispatch in serve()
fn handle_resources_list(id: &Value) -> Value {
    let tap_dirs = crate::tap::tap_dirs();
    let refs: Vec<&str> = tap_dirs.iter().map(|s| s.as_str()).collect();
    let taps = crate::tap::list_taps(&refs);

    let mut resources = vec![
        json!({
            "uri": "tap://protocol",
            "name": "Tap Protocol",
            "description": format!("Protocol v{}: 8 kernel + 16 stdlib", TAP_PROTOCOL_VERSION),
            "mimeType": "application/json"
        }),
        json!({
            "uri": "tap://logs",
            "name": "Tap Logs",
            "description": "Recent forge and execution events",
            "mimeType": "application/json"
        }),
    ];

    for tap in &taps {
        resources.push(json!({
            "uri": format!("tap://taps/{}/{}", tap.site, tap.name),
            "name": format!("{}/{}", tap.site, tap.name),
            "description": tap.description,
            "mimeType": "application/javascript"
        }));
    }

    json!({ "jsonrpc": "2.0", "id": id, "result": { "resources": resources } })
}

#[allow(dead_code)]
async fn handle_resources_read(id: &Value, params: &Value) -> Value {
    let uri = params["uri"].as_str().unwrap_or("");

    let (mime, content) = match uri {
        "tap://protocol" => {
            let kernel = ["eval", "pointer", "keyboard", "nav", "wait", "screenshot", "tap", "capabilities"];
            let stdlib = ["click", "type", "hover", "scroll", "pressKey", "select", "upload", "dialog",
                "fetch", "find", "cookies", "download", "waitFor", "waitForNetwork", "ssrState", "storage"];
            ("application/json", json!({
                "version": TAP_PROTOCOL_VERSION,
                "kernel": kernel, "stdlib": stdlib,
                "runtime": "chrome-extension"
            }).to_string())
        }
        "tap://logs" => {
            ("application/json", serde_json::to_string_pretty(&tap_log_read(100)).unwrap_or_default())
        }
        _ if uri.starts_with("tap://taps/") => {
            let path = uri.strip_prefix("tap://taps/").unwrap_or("");
            let parts: Vec<&str> = path.splitn(2, '/').collect();
            let mut source = String::new();
            if parts.len() == 2 {
                for dir in &crate::tap::tap_dirs() {
                    let file = format!("{}/{}/{}.tap.js", dir, parts[0], parts[1]);
                    if let Ok(s) = std::fs::read_to_string(&file) { source = s; break; }
                }
            }
            ("application/javascript", if source.is_empty() { format!("// not found: {}", uri) } else { source })
        }
        _ => ("text/plain", format!("unknown resource: {}", uri)),
    };

    json!({
        "jsonrpc": "2.0", "id": id,
        "result": { "contents": [{ "uri": uri, "mimeType": mime, "text": content }] }
    })
}

// ============================================================================
// PROMPTS — guided workflows (replaces FORGING.md)
// ============================================================================

#[allow(dead_code)] // called via string dispatch in serve()
fn handle_prompts_list(id: &Value) -> Value {
    json!({
        "jsonrpc": "2.0", "id": id,
        "result": { "prompts": [
            {
                "name": "forge",
                "description": "Create a new .tap.js script for a website. Guides: inspect → verify → save.",
                "arguments": [
                    { "name": "url", "description": "Target page URL", "required": true },
                    { "name": "capability", "description": "What the tap should do", "required": true }
                ]
            },
            {
                "name": "debug",
                "description": "Diagnose and fix a failing tap. Checks logs, reads source, re-forges if needed.",
                "arguments": [
                    { "name": "site", "description": "Site name", "required": true },
                    { "name": "name", "description": "Tap name", "required": true }
                ]
            }
        ]}
    })
}

#[allow(dead_code)]
fn handle_prompts_get(id: &Value, params: &Value) -> Value {
    let prompt_name = params["name"].as_str().unwrap_or("");
    let args = &params["arguments"];

    let text = match prompt_name {
        "forge" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("<URL>");
            let cap = args.get("capability").and_then(|v| v.as_str()).unwrap_or("<capability>");
            format!(r#"Create a .tap.js for: {url}
Capability: {cap}

## Workflow

1. **Inspect**: `forge_inspect(url="{url}")` → review framework, SSR state, APIs, strategies.

2. **Pick strategy** (priority):
   - SSR: `__INITIAL_STATE__` / `__NEXT_DATA__` / `__pinia` found → `page.eval(() => window.__STATE__)` (zero network)
   - API: endpoints in `api_hints` → `page.fetch(apiUrl)` (one request, structured)
   - DOM: fallback → `page.eval(() => querySelectorAll(...))` (always works, fragile)

3. **Write tap** using the strategy template from forge_inspect.

4. **Verify**: `forge_verify(url, expression)` — check rows, columns, sample data.

5. **Iterate** if needed:
   - Empty data → add `page.waitFor(selector)` before eval
   - Auth → `page.nav(domain)` first for session cookies
   - Wrong columns → check property names in returned objects

6. **Save**: `forge_save(site, name, code)`

## .tap.js format

```js
export default {{
  site: "example", name: "capability",
  description: "What it does",
  columns: ["col1", "col2"],
  health: {{ min_rows: 5, non_empty: ["col1"] }},
  async run(page, args) {{
    // extraction logic
    return [{{ col1: "value", col2: "value" }}]
  }}
}}
```

## Rules
- API > DOM. Always prefer `page.fetch()` over `page.eval(querySelectorAll)`.
- `page.click()` = CDP native (isTrusted). Never JS `.click()` in eval.
- All row values must be strings.
- Health contract required for read taps."#)
        }
        "debug" => {
            let site = args.get("site").and_then(|v| v.as_str()).unwrap_or("<site>");
            let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("<name>");
            format!(r#"Debug failing tap: {site}/{name}

## Workflow

1. **Check logs**: `tap_logs(site="{site}")` — look for error patterns, failure rate, timing.

2. **Read source**: resource `tap://taps/{site}/{name}` — understand current implementation.

3. **Diagnose**:
   - auth_required → cookies expired, site needs login
   - empty_page → page structure changed, selectors broken
   - Slow (high ms) → too many waits, inefficient extraction
   - rows=0, no error → extraction logic wrong, data moved

4. **Re-inspect**: `forge_inspect` on target URL — compare current page with what tap expects.

5. **Fix + verify**: modify extraction, `forge_verify` to test, iterate until correct.

6. **Save**: `forge_save` with updated code.

7. **Confirm**: `run_tap(site="{site}", name="{name}")` end-to-end."#)
        }
        _ => format!("Unknown prompt: {prompt_name}"),
    };

    json!({
        "jsonrpc": "2.0", "id": id,
        "result": { "messages": [{ "role": "user", "content": { "type": "text", "text": text } }] }
    })
}

// ============================================================================
// TOOLS — browser automation and forge pipeline
// ============================================================================

fn tools_schema() -> Value {
    json!([
        {
            "name": "tap.screenshot",
            "description": "Take a screenshot. Defaults to grayscale JPEG (smallest tokens). Action tools already return page state — only screenshot when you need visual confirmation.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Output file path (default: ~/.tap/cache/screenshot.jpg)" },
                    "format": { "type": "string", "enum": ["jpeg", "png"], "description": "Image format", "default": "jpeg" },
                    "quality": { "type": "integer", "description": "JPEG quality 1-100 (lower = smaller file)", "default": 50 },
                    "grayscale": { "type": "boolean", "description": "Strip color for smaller file size", "default": true }
                }
            }
        },
        {
            "name": "page.nav",
            "description": "Navigate to a URL. Returns page state (url, title) after load.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Target URL" }
                },
                "required": ["url"]
            }
        },
        {
            "name": "inspect.a11y",
            "description": "Get the accessibility tree — semantic page structure. Primary perception tool.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "depth": { "type": "integer", "description": "Max depth to traverse" }
                }
            }
        },
        {
            "name": "inspect.dom",
            "description": "Get a simplified DOM tree with key attributes (id, class, role, text, box).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector for subtree root (default: body)" },
                    "depth": { "type": "integer", "description": "Max depth", "default": 10 }
                }
            }
        },
        {
            "name": "inspect.page",
            "description": "Get current page info: URL, title, viewport, scroll position, readyState.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "page.find",
            "description": "Find elements by visible text. Returns list with tag, role, text, selector, coordinates.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Text to search for" },
                    "role": { "type": "string", "description": "Filter by element role (button, link, input, etc.)" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "inspect.element",
            "description": "Deep probe of a single element: tag, attributes, box model, visibility, editable.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector" }
                },
                "required": ["selector"]
            }
        },
        {
            "name": "page.click",
            "description": "Click on an element by visible text or CSS selector. Returns page state (url, title) after click — no screenshot needed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "target": { "type": "string", "description": "Visible text or CSS selector of the element to click" }
                },
                "required": ["target"]
            }
        },
        {
            "name": "page.type",
            "description": "Type text into an input. Returns current value + page state after typing — no screenshot needed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector of the input" },
                    "text": { "type": "string", "description": "Text to type" }
                },
                "required": ["selector", "text"]
            }
        },
        {
            "name": "page.hover",
            "description": "Hover over an element. Triggers CSS :hover, tooltips, dropdown menus.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector to hover" }
                },
                "required": ["selector"]
            }
        },
        {
            "name": "page.scroll",
            "description": "Scroll an element into view.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector to scroll to" }
                },
                "required": ["selector"]
            }
        },
        {
            "name": "page.pressKey",
            "description": "Press a key (Enter, Tab, Escape, etc.). Returns page state — detects navigation from form submit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "key": { "type": "string", "description": "Key name" },
                    "modifiers": { "type": "integer", "description": "Modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8", "default": 0 }
                },
                "required": ["key"]
            }
        },
        {
            "name": "page.select",
            "description": "Select an option in a <select> dropdown.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector of the <select>" },
                    "value": { "type": "string", "description": "Value to select" }
                },
                "required": ["selector", "value"]
            }
        },
        {
            "name": "page.upload",
            "description": "Upload files to a file input element via CDP.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": { "type": "string", "description": "CSS selector of the file input" },
                    "files": { "type": "string", "description": "Comma-separated file paths" }
                },
                "required": ["selector", "files"]
            }
        },
        {
            "name": "page.eval",
            "description": "Evaluate a JavaScript expression in the browser and return the result.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "expression": { "type": "string", "description": "JS expression to evaluate" }
                },
                "required": ["expression"]
            }
        },
        {
            "name": "page.cookies",
            "description": "Get cookies for the current page.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "page.dialog",
            "description": "Handle a JavaScript dialog (alert/confirm/prompt).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "accept": { "type": "boolean", "description": "Accept or dismiss", "default": true },
                    "prompt_text": { "type": "string", "description": "Text for prompt dialogs" }
                }
            }
        },
        {
            "name": "page.storage",
            "description": "Read localStorage or sessionStorage. Many SPAs store auth tokens, API keys, and user data here.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "type": { "type": "string", "description": "Storage type: 'local' (default) or 'session'" }
                }
            }
        },
        {
            "name": "page.setCookie",
            "description": "Set a cookie on a domain. Use for precise auth control.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "value": { "type": "string" },
                    "domain": { "type": "string" },
                    "path": { "type": "string", "description": "Cookie path (default: /)" }
                },
                "required": ["name", "value", "domain"]
            }
        },
        // ===== INSPECT — Deep Inspection Tools =====
        {
            "name": "inspect.apiLog",
            "description": "Get all API calls (fetch/XHR) recorded since page load. Returns url, method, status, request_body, response_body for each call. This captures everything the page does — no manual network log needed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "clear": { "type": "boolean", "description": "Clear the log after reading (default: false)" }
                }
            }
        },
        {
            "name": "inspect.networkStart",
            "description": "Start capturing network requests via CDP Network domain (pure protocol, no JS injection). Call this BEFORE triggering page actions to capture API calls.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "inspect.networkDump",
            "description": "Get captured network log entries (URL, method, status, headers, mime type) and clear the buffer. Set bodies=true to include full response bodies for API responses (filters to JSON/text only).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "bodies": { "type": "boolean", "description": "Include full response bodies (JSON/text only)", "default": false },
                    "url_filter": { "type": "string", "description": "Optional substring to filter URLs (e.g. 'api/' or 'graphql')" }
                }
            }
        },
        {
            "name": "inspect.globals",
            "description": "List all interesting global variables on the page. Discovers __INITIAL_STATE__, __NEXT_DATA__, __NUXT__, __pinia, Redux stores, and other framework/SSR state. One call reveals what data the page already has.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "inspect.resources",
            "description": "List all resources (scripts, stylesheets, images) loaded by the page. Pass optional url to get the source content of a specific resource, or query to search within all loaded JavaScript/HTML resources for a pattern.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "URL of a specific resource to read its content" },
                    "query": { "type": "string", "description": "Search pattern to find in loaded JS/HTML resources (e.g. '/api/', 'fetch(', 'axios')" }
                }
            }
        },
        {
            "name": "inspect.download",
            "description": "Download a resource to a local file using the browser session (cookies, referer, auth). Provide a URL to download directly, or a CSS selector to download an image from the current page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "URL to download" },
                    "selector": { "type": "string", "description": "CSS selector of an image element to download (e.g. 'img.hero', '#main-photo')" },
                    "output": { "type": "string", "description": "Output file path" }
                },
                "required": ["output"]
            }
        },
        // ===== FORGE — Tap Creation Pipeline =====
        {
            "name": "forge.inspect",
            "description": "One-shot page analysis for tap forging. Returns framework detection, SSR state (with data samples), API endpoint hints, interactive elements, auth state, and ranked strategy recommendations — all in a single call. Replaces 5-8 separate tool calls (screenshot + ax_tree + global_names + api_log + page_info). Call this FIRST when forging a new tap.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Navigate to this URL before analysis (optional — omit to analyze current page)" }
                }
            }
        },
        {
            "name": "forge.verify",
            "description": "One-shot test of tap extraction logic. Navigates to URL, waits, evaluates a JS expression in page context, and validates the result shape against expected columns. Combines navigate + wait + evaluate + validate into one call. Use this during forging to iterate quickly on the data extraction logic before saving.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "URL to navigate to" },
                    "wait_ms": { "type": "integer", "description": "Milliseconds to wait after navigation (default: 2000)", "default": 2000 },
                    "expression": { "type": "string", "description": "JS expression that returns an array of objects (the tap's data extraction logic)" },
                    "columns": { "type": "array", "items": { "type": "string" }, "description": "Expected column names — used to validate the result shape" }
                },
                "required": ["url", "expression"]
            }
        },
        {
            "name": "forge.save",
            "description": "Save a .tap.js file to disk. Writes to ~/.tap/taps/{site}/{name}.tap.js. Use after verifying the tap works with forge.verify.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "site": { "type": "string", "description": "Site name (e.g. 'weibo')" },
                    "name": { "type": "string", "description": "Tap name (e.g. 'hot')" },
                    "code": { "type": "string", "description": "Full .tap.js source code" }
                },
                "required": ["site", "name", "code"]
            }
        },
        // ===== TAP — Core tap operations =====
        {
            "name": "tap.list",
            "description": "List all available taps. Returns site, name, and description for each. Use this to discover what websites Tap can access.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tap.run",
            "description": "Run a tap and return structured data (JSON rows). This is the primary way to get data from websites. Example: tap.run({site: 'weibo', name: 'hot'}) returns trending topics.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "site": { "type": "string", "description": "Site name (e.g. 'weibo', 'bilibili')" },
                    "name": { "type": "string", "description": "Tap name (e.g. 'hot', 'trending')" },
                    "args": { "type": "object", "description": "Tap arguments (e.g. {limit: 10})", "additionalProperties": true }
                },
                "required": ["site", "name"]
            }
        },
        // ===== LOGS — Structured event log for AI analysis =====
        {
            "name": "tap.logs",
            "description": "Read recent structured log entries (forge + run events). Returns JSONL from ~/.tap/logs/tap.jsonl. Use to analyze tap performance, find flaky taps, and review forge history.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "description": "Number of recent entries to return (default 50)", "default": 50 },
                    "event": { "type": "string", "description": "Filter by event type: run, forge_inspect, forge_verify, forge_save" },
                    "site": { "type": "string", "description": "Filter by site name" }
                }
            }
        },
        // ===== INTERCEPT — Active Request Interception =====
        {
            "name": "intercept.on",
            "description": "Start intercepting requests matching a URL pattern. Paused requests appear in intercept.list. Use intercept.continue/fulfill/fail to handle them. TLS fingerprint unchanged — zero detection risk.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url_pattern": { "type": "string", "description": "URL pattern to match (e.g. '*api/search*', '*douyin.com/aweme*')" }
                },
                "required": ["url_pattern"]
            }
        },
        {
            "name": "intercept.off",
            "description": "Stop intercepting requests and release all paused requests.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "intercept.list",
            "description": "List all paused (intercepted) requests — shows requestId, url, method, headers, postData for each. Use requestId with intercept.continue/fulfill/fail.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "intercept.continue",
            "description": "Continue a paused request (optionally modify URL, headers, or POST body before sending to server).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "request_id": { "type": "string", "description": "Request ID from intercept.list" },
                    "url": { "type": "string", "description": "Override URL" },
                    "headers": { "type": "object", "description": "Override headers" },
                    "post_data": { "type": "string", "description": "Override POST body" }
                },
                "required": ["request_id"]
            }
        },
        {
            "name": "intercept.fulfill",
            "description": "Fulfill a paused request with a custom response (bypass server entirely). Useful for testing or mocking.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "request_id": { "type": "string", "description": "Request ID from intercept.list" },
                    "status": { "type": "number", "description": "HTTP status code (default: 200)" },
                    "body": { "type": "string", "description": "Response body" }
                },
                "required": ["request_id", "body"]
            }
        },
        {
            "name": "intercept.fail",
            "description": "Block a paused request (prevent it from reaching the server).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "request_id": { "type": "string", "description": "Request ID from intercept.list" }
                },
                "required": ["request_id"]
            }
        },
        // --- Tab Management ---
        {
            "name": "tab.list",
            "description": "List all open browser tabs. Returns tabId, url, title for each tab. Use tabId in other tools to target a specific tab.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "tab.new",
            "description": "Open a new browser tab. Returns tabId to use with other tools. Optionally navigate to a URL.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "URL to open (default: about:blank)" }
                }
            }
        },
        {
            "name": "tab.close",
            "description": "Close a browser tab by tabId.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tabId": { "type": "integer", "description": "Tab ID to close" }
                },
                "required": ["tabId"]
            }
        },
    ])
}

async fn handle_tool_call(id: &Value, params: &Value, client: &BridgeClient) -> Value {
    let tool_name = params["name"].as_str().unwrap_or("");
    let args = &params["arguments"];

    let result = execute_tool(tool_name, args, client).await;

    // For action tools, collect any toasts/notifications that appeared
    let is_action = matches!(
        tool_name,
        "page.click"
            | "page.type"
            | "page.pressKey"
            | "page.select"
            | "page.nav"
            | "page.scroll"
            | "page.upload"
    );
    let toasts = if is_action {
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        client
            .send_tap("tool", "collect_toasts", json!({}), -1)
            .await
            .ok()
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
    } else {
        vec![]
    };

    match result {
        Ok(content) => {
            let mut text = if content.is_string() {
                content.as_str().unwrap().to_string()
            } else {
                serde_json::to_string_pretty(&content).unwrap_or_default()
            };

            // Append toast notifications if any
            if !toasts.is_empty() {
                let msgs: Vec<&str> = toasts.iter().filter_map(|t| t["text"].as_str()).collect();
                if !msgs.is_empty() {
                    text.push_str(&format!("\n\n[page notifications: {}]", msgs.join("; ")));
                }
            }

            json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{"type": "text", "text": text}]
                }
            })
        }
        Err(e) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{
                    "type": "text",
                    "text": format!("error: {}", e)
                }],
                "isError": true
            }
        }),
    }
}

/// Route an MCP tool call to the extension bridge.
///
/// Most tools relay directly as CDP commands via `client.send()`.
/// A few (forge_verify, forge_save, list_taps) have local logic.
async fn execute_tool(
    name: &str,
    args: &Value,
    client: &BridgeClient,
) -> Result<Value, Box<dyn std::error::Error>> {
    match name {
        // --- Tools with local logic ---
        "forge.inspect" => {
            let tab_id = extract_tab_id(args);
            let start = std::time::Instant::now();
            let url = args["url"].as_str().unwrap_or("");
            if !url.is_empty() {
                client
                    .send_tap("cdp", "Page.navigate", json!({ "url": url }), tab_id)
                    .await?;
            }
            let result = client
                .send_tap("tool", "forge_inspect", json!({}), tab_id)
                .await?;
            tap_log(&json!({
                "event": "forge_inspect",
                "url": url,
                "ms": start.elapsed().as_millis() as u64,
                "framework": result.get("framework").and_then(|v| v.as_str()).unwrap_or("unknown"),
                "strategies": result.get("strategies").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
            }));
            Ok(result)
        }
        "tap.list" => {
            client
                .send_tap("tool", "list", json!({}), -1)
                .await
        }
        "tap.run" => {
            let site = args["site"].as_str().ok_or("missing site")?;
            let name_arg = args["name"].as_str().ok_or("missing name")?;
            let tap_args = args.get("args").cloned().unwrap_or(json!({}));
            let tab_id = extract_tab_id(args);
            let start = std::time::Instant::now();
            let run_params = json!({"site": site, "name": name_arg, "args": tap_args});
            let result = client
                .send_tap("tool", "run", run_params, tab_id)
                .await;
            let ms = start.elapsed().as_millis() as u64;

            match result {
                Ok(mut result) => {
                    let rows = result.get("rows").and_then(|r| r.as_array());
                    let row_count = rows.map(|r| r.len()).unwrap_or(0);
                    // Health validation
                    let health_status = if let Some(rows) = rows {
                        if let Some(contract) = result
                            .get("health")
                            .and_then(crate::tap::parse_health_contract)
                        {
                            let report = crate::health::validate(
                                &format!("{}/{}", site, name_arg), &contract, rows);
                            let status = match report.status {
                                crate::health::HealthStatus::Healthy => "pass",
                                _ => "fail",
                            };
                            result["health_report"] = serde_json::to_value(&report).unwrap_or_default();
                            status
                        } else { "none" }
                    } else { "none" };

                    tap_log(&json!({
                        "event": "run",
                        "site": site, "name": name_arg,
                        "rows": row_count, "ms": ms,
                        "health": health_status,
                    }));
                    Ok(result)
                }
                Err(e) => {
                    tap_log(&json!({
                        "event": "run",
                        "site": site, "name": name_arg,
                        "rows": 0, "ms": ms,
                        "health": "error", "error": e.to_string(),
                    }));
                    Err(e)
                }
            }
        }
        "forge.verify" => {
            let url = args["url"].as_str().ok_or("missing url")?;
            let wait_ms = args["wait_ms"].as_u64().unwrap_or(2000);
            let expression = args["expression"].as_str().ok_or("missing expression")?;
            let columns: Vec<&str> = args["columns"]
                .as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                .unwrap_or_default();

            let start = std::time::Instant::now();
            let tab_id = extract_tab_id(args);
            client
                .send_tap("cdp", "Page.navigate", json!({ "url": url }), tab_id)
                .await?;
            if wait_ms > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(wait_ms)).await;
            }
            let eval_result = client
                .send_tap(
                    "cdp",
                    "Runtime.evaluate",
                    json!({ "expression": expression }),
                    tab_id,
                )
                .await?;
            let result = eval_result
                .get("result")
                .and_then(|r| r.get("value"))
                .cloned()
                .unwrap_or(Value::Null);
            let duration_ms = start.elapsed().as_millis();

            let mut diagnostics = Vec::new();
            let rows = result.as_array();
            let row_count = rows.map(|r| r.len()).unwrap_or(0);

            match rows {
                None => {
                    diagnostics.push("FAIL: expression did not return an array".to_string());
                }
                Some(r) if r.is_empty() => {
                    diagnostics.push("WARN: expression returned empty array".to_string());
                }
                Some(r) => {
                    diagnostics.push(format!("OK: {} rows returned", r.len()));
                    if !columns.is_empty() {
                        if let Some(obj) = r.first().and_then(|v| v.as_object()) {
                            let actual: Vec<&str> = obj.keys().map(|k| k.as_str()).collect();
                            let missing: Vec<_> =
                                columns.iter().filter(|c| !actual.contains(*c)).collect();
                            if missing.is_empty() {
                                diagnostics
                                    .push(format!("OK: all {} columns present", columns.len()));
                            } else {
                                diagnostics.push(format!("FAIL: missing columns: {:?}", missing));
                            }
                        }
                    }
                }
            }

            let status = if diagnostics.iter().any(|d| d.starts_with("FAIL")) { "fail" } else { "pass" };
            tap_log(&json!({
                "event": "forge_verify",
                "url": url, "rows": row_count,
                "ms": duration_ms, "status": status,
            }));
            Ok(json!({
                "status": status,
                "row_count": row_count,
                "duration_ms": duration_ms,
                "sample": rows.map(|r| r.iter().take(5).cloned().collect::<Vec<_>>()).unwrap_or_default(),
                "diagnostics": diagnostics
            }))
        }
        "tap.logs" => {
            let limit = args["limit"].as_u64().unwrap_or(50) as usize;
            let event_filter = args["event"].as_str();
            let site_filter = args["site"].as_str();
            let mut entries = tap_log_read(limit.max(200)); // read extra for filtering
            if let Some(ev) = event_filter {
                entries.retain(|e| e.get("event").and_then(|v| v.as_str()) == Some(ev));
            }
            if let Some(s) = site_filter {
                entries.retain(|e| e.get("site").and_then(|v| v.as_str()) == Some(s));
            }
            entries.truncate(limit);
            Ok(json!({ "count": entries.len(), "entries": entries }))
        }
        "forge.save" => {
            let site = args["site"].as_str().ok_or("missing site")?;
            let tap_name = args["name"].as_str().ok_or("missing name")?;
            let code = args["code"].as_str().ok_or("missing code")?;

            // Save to extension/taps/ (dev) and TAP_HOME/taps/ (user)
            let dirs = vec![
                format!("extension/taps/{}", site),
                format!("{}/taps/{}", tap_home(), site),
            ];
            let mut saved_to = String::new();
            for dir in &dirs {
                if let Ok(()) = std::fs::create_dir_all(dir) {
                    let path = format!("{}/{}.tap.js", dir, tap_name);
                    if std::fs::write(&path, code).is_ok() && saved_to.is_empty() {
                        saved_to = path;
                    }
                }
            }

            // Update manifest.json if extension/taps/ exists
            if std::path::Path::new("extension/taps").is_dir() {
                let _ = update_taps_manifest();
            }

            if saved_to.is_empty() {
                Err("failed to save tap file".into())
            } else {
                tap_log(&json!({
                    "event": "forge_save",
                    "site": site, "name": tap_name,
                    "path": saved_to,
                }));
                Ok(json!(format!(
                    "saved to {} — reload extension to activate",
                    saved_to
                )))
            }
        }

        // --- Screenshot: capture, decode base64, save to file ---
        "tap.screenshot" => {
            let grayscale = args["grayscale"].as_bool().unwrap_or(true);
            let format = args["format"].as_str().unwrap_or("jpeg");
            let quality = args["quality"].as_u64().unwrap_or(50);
            let default_ext = if format == "jpeg" { "jpg" } else { "png" };
            let default_path = format!("{}/screenshot.{}", tap_cache(), default_ext);
            let path = args["path"].as_str().unwrap_or(&default_path);

            let mut capture_params = json!({
                "format": format,
                "grayscale": grayscale
            });
            if format == "jpeg" {
                capture_params["quality"] = json!(quality);
            }
            let tab_id = extract_tab_id(args);
            let result = client
                .send_tap("cdp", "Page.captureScreenshot", capture_params, tab_id)
                .await?;
            if let Some(b64) = result["data"].as_str() {
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| format!("base64 decode: {}", e))?;
                std::fs::write(path, &bytes).map_err(|e| format!("write {}: {}", path, e))?;
                Ok(json!(format!("saved to {} ({} bytes)", path, bytes.len())))
            } else {
                Err("screenshot: no data returned".into())
            }
        }

        // --- Accessibility tree with optional interactive filter ---
        "inspect.a11y" => {
            let tab_id = extract_tab_id(args);
            let filter = args["filter"].as_str().unwrap_or("all");
            if filter == "interactive" {
                client
                    .send_tap("tool", "ax_tree_interactive", json!({}), tab_id)
                    .await
            } else {
                let result = client
                    .send_tap("cdp", "Accessibility.getFullAXTree", json!({}), tab_id)
                    .await?;
                let text = serde_json::to_string(&result).unwrap_or_default();
                if text.len() > 50_000 {
                    Ok(json!({
                        "truncated": true,
                        "note": format!("Full AX tree was {}KB — use filter='interactive' for a focused view.", text.len() / 1024),
                        "tree": &text[..50_000]
                    }))
                } else {
                    Ok(result)
                }
            }
        }

        // --- DOM tree with extension-side summarization ---
        "inspect.dom" => {
            let tab_id = extract_tab_id(args);
            client.send_tap("tool", "read_dom", args.clone(), tab_id).await
        }

        // --- Download: fetch via browser (by URL or selector), save to file ---
        "inspect.download" => {
            let tab_id = extract_tab_id(args);
            // Determine extension method: save_image if selector provided, download if url
            let ext_method = if args["selector"].is_string() { "save_image" } else { "download" };
            let result = client
                .send_tap("tool", ext_method, args.clone(), tab_id)
                .await?;
            if let Some(data_url) = result["data"].as_str() {
                let output = args["output"].as_str().ok_or("missing output path")?;
                let b64 = data_url.split(',').next_back().unwrap_or(data_url);
                use base64::Engine;
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(b64)
                    .map_err(|e| format!("base64 decode: {}", e))?;
                std::fs::write(output, &bytes).map_err(|e| format!("write {}: {}", output, e))?;
                Ok(json!(format!(
                    "saved to {} ({} bytes)",
                    output,
                    bytes.len()
                )))
            } else {
                Err("inspect.download: no data returned".into())
            }
        }

        // --- CDP relay tools — forward via protocol envelope ---
        "page.nav" => {
            let tab_id = extract_tab_id(args);
            let url = args["url"].as_str().ok_or("missing url")?;
            client
                .send_tap("cdp", "Page.navigate", json!({ "url": url }), tab_id)
                .await?;
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            let info = client
                .send_tap("tool", "page_info", json!({}), tab_id)
                .await
                .ok();
            let nav_url = info
                .as_ref()
                .and_then(|v| v["url"].as_str())
                .unwrap_or("?");
            let title = info
                .as_ref()
                .and_then(|v| v["title"].as_str())
                .unwrap_or("?");
            Ok(json!(format!("navigated\n  → url: {}\n  → title: {}", nav_url, title)))
        }
        "page.eval" => {
            let tab_id = extract_tab_id(args);
            let expression = args["expression"].as_str().ok_or("missing expression")?;
            let result = client
                .send_tap(
                    "cdp",
                    "Runtime.evaluate",
                    json!({ "expression": expression }),
                    tab_id,
                )
                .await?;
            let value = result
                .get("result")
                .and_then(|r| r.get("value"))
                .cloned()
                .unwrap_or(Value::Null);
            Ok(value)
        }

        // All other tools: relay via protocol envelope
        _ => relay_to_extension(name, args, client).await,
    }
}

/// Extract tabId from args, defaulting to -1 (use active tab).
fn extract_tab_id(args: &Value) -> i64 {
    args.get("tabId").and_then(|v| v.as_i64()).unwrap_or(-1)
}

/// Relay an MCP tool call to the extension via Tap protocol envelope.
///
/// Wire format: {"protocol":"tap/1.0","id":N,"type":"tool","method":"...","params":{...},"tabId":N}
async fn relay_to_extension(
    name: &str,
    args: &Value,
    client: &BridgeClient,
) -> Result<Value, Box<dyn std::error::Error>> {
    let tab_id = extract_tab_id(args);
    // Strip category prefix for extension dispatch (e.g., "page.click" -> "click")
    let method = name.split('.').next_back().unwrap_or(name);
    client
        .send_tap("tool", method, args.clone(), tab_id)
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── MCP Standard Format Compliance ──

    #[test]
    fn initialize_response_has_required_fields() {
        // Why: MCP spec requires protocolVersion, capabilities, serverInfo in initialize
        let resp = handle_initialize(&json!(1));
        let result = &resp["result"];
        assert_eq!(result["protocolVersion"], "2024-11-05", "must declare MCP protocol version");
        assert!(result["capabilities"]["tools"].is_object(), "must declare tools capability");
        assert!(result["capabilities"]["resources"].is_object(), "must declare resources capability");
        assert!(result["capabilities"]["prompts"].is_object(), "must declare prompts capability");
        assert_eq!(result["serverInfo"]["name"], "tap");
        assert!(!result["serverInfo"]["version"].as_str().unwrap_or("").is_empty(), "must have version");
        assert_eq!(result["serverInfo"]["tapProtocol"], TAP_PROTOCOL_VERSION, "must expose tap protocol version");
    }

    #[test]
    fn tap_protocol_version_matches_extension() {
        // Why: mcp.rs and protocol.js must agree on protocol version — mismatch = silent breakage
        let extension_src = std::fs::read_to_string("extension/protocol/protocol.js")
            .expect("protocol.js must exist");
        let expected = format!("PROTOCOL_VERSION = '{}'", TAP_PROTOCOL_VERSION);
        assert!(extension_src.contains(&expected),
            "protocol.js PROTOCOL_VERSION must match mcp.rs TAP_PROTOCOL_VERSION ({})", TAP_PROTOCOL_VERSION);
    }

    #[test]
    fn every_tool_has_valid_schema() {
        // Why: MCP spec requires name, description, inputSchema for each tool
        let schema = tools_schema();
        let tools = schema.as_array().unwrap();
        assert!(tools.len() >= 20, "should have 20+ tools, got {}", tools.len());
        for tool in tools {
            let name = tool["name"].as_str().unwrap_or("");
            assert!(!name.is_empty(), "tool must have name");
            assert!(tool["description"].is_string(), "tool {} must have description", name);
            assert_eq!(tool["inputSchema"]["type"], "object", "tool {} inputSchema must be object", name);
        }
    }

    #[test]
    fn resources_list_has_valid_format() {
        // Why: MCP spec requires uri, name for each resource
        let resp = handle_resources_list(&json!(1));
        let resources = resp["result"]["resources"].as_array().unwrap();
        assert!(resources.len() >= 2, "must have at least protocol + logs resources");
        for r in resources {
            assert!(r["uri"].is_string(), "resource must have uri");
            assert!(r["name"].is_string(), "resource must have name");
            let uri = r["uri"].as_str().unwrap();
            assert!(uri.starts_with("tap://"), "resource URI must use tap:// scheme, got {}", uri);
        }
    }

    #[test]
    fn prompts_list_has_valid_format() {
        // Why: MCP spec requires name, description for each prompt
        let resp = handle_prompts_list(&json!(1));
        let prompts = resp["result"]["prompts"].as_array().unwrap();
        assert!(prompts.len() >= 2, "must have forge + debug prompts");
        for p in prompts {
            assert!(p["name"].is_string(), "prompt must have name");
            assert!(p["description"].is_string(), "prompt must have description");
        }
        // forge prompt must have url and capability arguments
        let forge = prompts.iter().find(|p| p["name"] == "forge").unwrap();
        let args = forge["arguments"].as_array().unwrap();
        assert!(args.iter().any(|a| a["name"] == "url"), "forge must have url argument");
        assert!(args.iter().any(|a| a["name"] == "capability"), "forge must have capability argument");
    }

    // ── Tool Existence Constraints ──

    #[test]
    fn tools_schema_includes_list_taps() {
        let schema = tools_schema();
        let tools = schema.as_array().unwrap();
        assert!(
            tools.iter().any(|t| t["name"] == "tap.list"),
            "MCP tools must include tap.list"
        );
    }

    #[test]
    fn tools_schema_includes_run_tap() {
        let schema = tools_schema();
        let tools = schema.as_array().unwrap();
        assert!(
            tools.iter().any(|t| t["name"] == "tap.run"),
            "MCP tools must include tap.run"
        );
        let tool = tools.iter().find(|t| t["name"] == "tap.run").unwrap();
        let required = tool["inputSchema"]["required"].as_array().unwrap();
        assert!(required.contains(&json!("site")));
        assert!(required.contains(&json!("name")));
    }

    #[test]
    fn tools_schema_includes_inspect_tools() {
        let schema = tools_schema();
        let tools = schema.as_array().unwrap();
        let inspect_tools = [
            "inspect.apiLog",
            "inspect.globals",
            "inspect.resources",
            "page.storage",
        ];
        for tool_name in &inspect_tools {
            assert!(
                tools.iter().any(|t| t["name"] == *tool_name),
                "MCP tools must include {}",
                tool_name
            );
        }
    }

    #[test]
    fn relay_has_no_inline_js() {
        // Why: Rust binary must be zero-JS — all page logic belongs in the extension
        let source = include_str!("mcp.rs");
        let relay_section = source
            .split("fn relay_to_extension")
            .nth(1)
            .expect("relay_to_extension must exist");
        assert!(
            !relay_section.contains("JSON.stringify"),
            "relay_to_extension must not contain inline JS — move to extension"
        );
    }

    #[test]
    fn no_legacy_tap_prefix_in_send_calls() {
        // Why: all bridge communication uses send_tap() protocol envelope now
        let source = include_str!("mcp.rs");
        let execute_section = source
            .split("async fn execute_tool")
            .nth(1)
            .expect("execute_tool must exist");
        assert!(
            !execute_section.contains(r#"send("Tap."#),
            "execute_tool must not use legacy client.send(\"Tap.*\") — use send_tap()"
        );
        assert!(
            !execute_section.contains(r#""Tap.{}"#),
            "execute_tool must not format Tap.* prefixes — use send_tap()"
        );
    }

    #[test]
    fn tools_schema_includes_intercept_tools() {
        let schema = tools_schema();
        let tools = schema.as_array().unwrap();
        let intercept_tools = [
            "intercept.on",
            "intercept.off",
            "intercept.list",
            "intercept.continue",
            "intercept.fulfill",
            "intercept.fail",
            "page.setCookie",
        ];
        for tool_name in &intercept_tools {
            assert!(
                tools.iter().any(|t| t["name"] == *tool_name),
                "MCP tools must include {}",
                tool_name
            );
        }
    }
}
