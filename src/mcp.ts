/**
 * MCP server — JSON-RPC over stdin/stdout.
 *
 * Thin layer: translates MCP method calls into tap executor calls.
 * Tools schema is generated from the 24 page API methods + forge tools.
 */

export function handleInitialize(id: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: "tap", version: "0.4.0", tapProtocol: "1.0.0" },
    },
  };
}

export function handleToolsList(id: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result: { tools: buildToolsSchema() },
  };
}

export function handlePromptsList(id: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      prompts: [
        {
          name: "forge",
          description:
            "Create a new .tap.js script for a website. Guides: inspect → verify → save.",
          arguments: [
            { name: "url", description: "Target page URL", required: true },
            {
              name: "capability",
              description: "What the tap should do",
              required: true,
            },
          ],
        },
        {
          name: "debug",
          description:
            "Diagnose and fix a failing tap. Checks logs, reads source, re-forges if needed.",
          arguments: [
            { name: "site", description: "Site name", required: true },
            { name: "name", description: "Tap name", required: true },
          ],
        },
        {
          name: "run",
          description:
            "Execute a task on a website. Checks for existing taps first — runs them if found, forges a new one if not.",
          arguments: [
            { name: "url", description: "Target page URL", required: true },
            { name: "task", description: "What to do on the page", required: true },
          ],
        },
      ],
    },
  };
}

export function handlePromptsGet(
  id: unknown,
  params: { name: string; arguments: Record<string, string> },
) {
  const args = params.arguments || {};
  let text: string;

  switch (params.name) {
    case "forge": {
      const url = args.url || "<URL>";
      const cap = args.capability || "<capability>";
      text = `Create a .tap.js for: ${url}
Capability: ${cap}

## Workflow

1. **Inspect**: \`forge_inspect(url="${url}")\` → review framework, SSR state, APIs, strategies.

2. **Pick strategy** (priority):
   - SSR: \`__INITIAL_STATE__\` / \`__NEXT_DATA__\` → \`page.eval(() => window.__STATE__)\`
   - API: endpoints in api_hints → \`page.fetch(apiUrl)\`
   - DOM: fallback → \`page.eval(() => querySelectorAll(...))\`

3. **Write tap** using the strategy template from forge_inspect.

4. **Verify**: \`forge_verify(url, expression)\` — check rows, columns, sample data.

5. **Iterate** if needed:
   - Empty data → add \`page.waitFor(selector)\` before eval
   - Auth → \`page.nav(domain)\` first for session cookies

6. **Save**: \`forge_save(site, name, code)\`

## Rules
- API > DOM. Always prefer \`page.fetch()\` over \`page.eval(querySelectorAll)\`.
- \`page.click()\` = CDP native. Never JS \`.click()\` in eval.
- All row values must be strings.
- Health contract required for read taps.`;
      break;
    }
    case "debug": {
      const site = args.site || "<site>";
      const name = args.name || "<name>";
      text = `Debug failing tap: ${site}/${name}

## Workflow

1. **Check logs**: \`tap.logs(site="${site}")\` — look for error patterns, failure rate, timing.

2. **Diagnose**:
   - auth_required → cookies expired, site needs login
   - empty_page → page structure changed, selectors broken
   - rows=0, no error → extraction logic wrong

3. **Re-inspect**: \`forge_inspect\` on target URL — compare current page with tap expectations.

4. **Fix + verify**: modify extraction, \`forge_verify\` to test, iterate until correct.

5. **Save**: \`forge_save\` with updated code.

6. **Confirm**: \`tap.run(site="${site}", name="${name}")\` end-to-end.`;
      break;
    }
    case "run": {
      const url = args.url || "<URL>";
      const task = args.task || "<task>";
      text = `Task: ${task}
URL: ${url}

## Workflow

1. **Check existing taps**: \`tap.list()\` — scan for a tap matching this site and task.

2. **If match found** → \`tap.run(site, name)\`. Done.
   - If result looks wrong (empty rows, stale data) → go to debug prompt.

3. **If no match** → forge a new tap:
   - \`forge.inspect(url="${url}")\` → pick strategy (SSR > API > DOM).
   - Write tap, \`forge.verify\` to confirm, \`forge.save\` to persist.
   - \`tap.run\` the saved tap.

4. **Only use page.* tools directly** when the task is one-off (no reuse value)
   or requires interactive steps a tap can't encode (login flows, multi-step forms).

## Rules
- tap.run > page.* always. A saved tap runs zero AI at runtime — faster and stable.
- If you forge a new tap, it is now available for all future requests on this site.`;
      break;
    }
    default:
      text = `Unknown prompt: ${params.name}`;
  }

  return {
    jsonrpc: "2.0",
    id,
    result: {
      messages: [{ role: "user", content: { type: "text", text } }],
    },
  };
}

export function handleResourcesList(id: unknown) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      resources: [
        {
          uri: "tap://protocol",
          name: "Tap Protocol",
          description: "Protocol v1.0: 8 kernel + 16 stdlib",
          mimeType: "application/json",
        },
        {
          uri: "tap://logs",
          name: "Tap Logs",
          description: "Recent forge and execution events",
          mimeType: "application/json",
        },
      ],
    },
  };
}

export function buildToolsSchema() {
  return [
    // Tap operations
    {
      name: "tap.list",
      description: "List all available taps. ALWAYS call this first before any page.* tool. If a matching tap exists, use tap.run — it executes with zero AI, faster and more stable than manual page operations.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "tap.run",
      description:
        "Run a pre-built tap. Preferred over page.* tools — deterministic, zero AI at runtime. Workflow: tap.list → tap.run (if match) → forge if none. Returns {columns, rows, count, timing}. If rows is empty, use forge.inspect to re-forge.",
      inputSchema: {
        type: "object",
        properties: {
          site: { type: "string", description: "Site name" },
          name: { type: "string", description: "Tap name" },
          args: { type: "object", description: "Tap arguments", additionalProperties: true },
        },
        required: ["site", "name"],
      },
    },
    {
      name: "tap.screenshot",
      description: "Take a screenshot of the current page. Prefer inspect.page, page.eval, or inspect.a11y for extracting page info — screenshot is expensive and should only be used for visual verification.",
      inputSchema: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["jpeg", "png"], default: "jpeg" },
          quality: { type: "integer", default: 50 },
        },
      },
    },
    {
      name: "tap.logs",
      description: "Read recent run/forge events. Use to diagnose failures — check error fields, row counts, and timing. If a tap keeps failing, re-forge it.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", default: 50 },
          site: { type: "string" },
        },
      },
    },
    {
      name: "tap.reload",
      description:
        "Reload all connected runtimes via daemon broadcast. Each runtime handles reload its own way.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "tap.version",
      description: "Get extension version info.",
      inputSchema: { type: "object", properties: {} },
    },
    // Forge
    {
      name: "forge.inspect",
      description: "Analyze a page for tap forging: detects framework, SSR state, APIs, and generates extraction strategies. Also use this to re-forge a broken tap — inspect the page again to find what changed.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
      },
    },
    {
      name: "forge.verify",
      description: "Test extraction logic live on a URL. Returns the actual data — verify columns and row count before saving. If the result is wrong, adjust the expression and verify again.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string" },
          expression: { type: "string" },
          columns: { type: "array", items: { type: "string" } },
        },
        required: ["url", "expression"],
      },
    },
    {
      name: "forge.save",
      description: "Save a .tap.js file to disk. After saving, tap.run can execute it forever with zero AI. Use forge.verify first to confirm the logic works.",
      inputSchema: {
        type: "object",
        properties: {
          site: { type: "string" },
          name: { type: "string" },
          code: { type: "string" },
        },
        required: ["site", "name", "code"],
      },
    },
    // Page
    {
      name: "page.nav",
      description: "Navigate to a URL. Returns {tabId, url, title}. If url differs from requested, a redirect occurred.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    {
      name: "page.click",
      description: "Click on an element by visible text or CSS selector. Returns the resulting url and title. Use page.find first if unsure whether the element exists.",
      inputSchema: {
        type: "object",
        properties: { target: { type: "string" } },
        required: ["target"],
      },
    },
    {
      name: "page.type",
      description: "Type text into an input. Auto-detects editor type (standard input, contentEditable, CodeMirror, Draft.js, ProseMirror). Returns the current value — if it doesn't match your input, try page.eval with execCommand('insertText') or the editor's native API.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
        },
        required: ["selector", "text"],
      },
    },
    {
      name: "page.fill",
      description:
        "Fill an element with text (clear + set atomically via setter). Fastest for long text or programmatic injection. No keyboard simulation.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          text: { type: "string" },
        },
        required: ["selector", "text"],
      },
    },
    {
      name: "page.eval",
      description: "Evaluate JavaScript in the browser. The universal escape hatch — use when other page.* tools can't do what you need. Falls back to CDP Runtime.evaluate on CSP-strict sites.",
      inputSchema: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
    {
      name: "page.find",
      description: "Find elements by visible text. Returns position, selector, and bounding box. Use before click/type to verify the target exists. Works on CSP-strict sites.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          role: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "page.hover",
      description: "Hover over an element.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string" } },
        required: ["selector"],
      },
    },
    {
      name: "page.scroll",
      description: "Scroll an element into view.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string" } },
        required: ["selector"],
      },
    },
    {
      name: "page.pressKey",
      description: "Press a key.",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string" },
          modifiers: { type: "integer", default: 0 },
        },
        required: ["key"],
      },
    },
    {
      name: "page.select",
      description: "Select an option in a dropdown.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          value: { type: "string" },
        },
        required: ["selector", "value"],
      },
    },
    {
      name: "page.upload",
      description: "Upload files to a file input.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string" },
          files: { type: "string" },
        },
        required: ["selector", "files"],
      },
    },
    {
      name: "page.dialog",
      description: "Handle a JavaScript dialog.",
      inputSchema: {
        type: "object",
        properties: {
          accept: { type: "boolean", default: true },
          prompt_text: { type: "string" },
        },
      },
    },
    {
      name: "page.cookies",
      description: "Get cookies for the current page.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "page.setCookie",
      description: "Set a cookie.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          value: { type: "string" },
          domain: { type: "string" },
        },
        required: ["name", "value"],
      },
    },
    {
      name: "page.storage",
      description: "Read localStorage/sessionStorage.",
      inputSchema: {
        type: "object",
        properties: { type: { type: "string" } },
      },
    },
    // Inspect
    {
      name: "inspect.dom",
      description: "Get page DOM structure.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string" } },
      },
    },
    {
      name: "inspect.page",
      description: "Get page info (url, title, meta).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.a11y",
      description: "Get accessibility tree.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.element",
      description: "Inspect a specific element.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string" } },
        required: ["selector"],
      },
    },
    {
      name: "inspect.resources",
      description: "List page resources.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.globals",
      description: "List global JS variables.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.apiLog",
      description: "Get captured API calls.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.networkStart",
      description: "Start network capture.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.networkDump",
      description: "Dump captured network log.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "inspect.download",
      description: "Download and parse a URL.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
    // Tab
    {
      name: "tab.list",
      description: "List open browser tabs.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "tab.new",
      description: "Open a new tab.",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
      },
    },
    {
      name: "tab.close",
      description: "Close a tab.",
      inputSchema: {
        type: "object",
        properties: { tabId: { type: "integer" } },
      },
    },
    // Intercept
    {
      name: "intercept.on",
      description: "Enable request interception.",
      inputSchema: {
        type: "object",
        properties: { patterns: { type: "array", items: { type: "string" } } },
      },
    },
    {
      name: "intercept.off",
      description: "Disable request interception.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "intercept.list",
      description: "List intercepted requests.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "intercept.continue",
      description: "Continue an intercepted request.",
      inputSchema: {
        type: "object",
        properties: { requestId: { type: "string" } },
        required: ["requestId"],
      },
    },
    {
      name: "intercept.fulfill",
      description: "Fulfill an intercepted request with custom response.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          status: { type: "integer" },
          body: { type: "string" },
        },
        required: ["requestId"],
      },
    },
    {
      name: "intercept.fail",
      description: "Fail an intercepted request.",
      inputSchema: {
        type: "object",
        properties: {
          requestId: { type: "string" },
          reason: { type: "string" },
        },
        required: ["requestId"],
      },
    },
  ];
}
