#!/usr/bin/env -S deno run --allow-all --no-check
/**
 * Tap CLI — entry point for all commands.
 *
 * Usage:
 *   tap list                     — list available taps
 *   tap daemon                   — run bridge daemon (foreground)
 *   tap mcp                      — run MCP server (stdin/stdout)
 *   tap <site> <name> [--args]   — run a tap
 */

import { startDaemon, EXTENSION_PORT, CLIENT_PORT } from "./daemon.ts";
import { connectToDaemon, BridgeClient } from "./bridge.ts";
import { listTaps, loadTap, runTap } from "./executor.ts";
import { type RpcSend } from "./page.ts";
import { forgeInspect } from "./forge.ts";
import { handleInitialize, handleToolsList, handlePromptsList, handlePromptsGet, handleResourcesList, buildToolsSchema } from "./mcp.ts";

// --- Status line (stderr, single-line rewrite) ---

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const isTTY = Deno.stderr.isTerminal?.() ?? false;

class StatusLine {
  private frame = 0;
  private timer: number | null = null;
  private text = "";
  private startMs = performance.now();
  private stepStart = performance.now();

  start(label: string) {
    this.text = label;
    this.startMs = performance.now();
    this.stepStart = this.startMs;
    if (isTTY) {
      this.timer = setInterval(() => this.render(), 80);
      this.render();
    } else {
      this.log(label);
    }
  }

  update(label: string) {
    const elapsed = this.elapsed(this.stepStart);
    if (isTTY) {
      // Print completed step on its own line, then continue spinner
      this.clearLine();
      this.log(`  ✔ ${this.text} ${elapsed}`);
    } else {
      this.log(`  ✔ ${this.text} ${elapsed}`);
    }
    this.text = label;
    this.stepStart = performance.now();
    if (isTTY) this.render();
  }

  done(summary: string) {
    const elapsed = this.elapsed(this.stepStart);
    if (isTTY) {
      this.clearLine();
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
    this.log(`  ✔ ${this.text} ${elapsed}`);
    const total = this.elapsed(this.startMs);
    this.log(`✔ ${summary} ${total}`);
  }

  fail(msg: string) {
    if (isTTY) {
      this.clearLine();
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
    this.log(`✘ ${msg} ${this.elapsed(this.startMs)}`);
  }

  private render() {
    const spinner = SPINNER[this.frame++ % SPINNER.length];
    const elapsed = this.elapsed(this.stepStart);
    const line = `  ${spinner} ${this.text} ${elapsed}`;
    this.clearLine();
    const bytes = new TextEncoder().encode(line);
    Deno.stderr.writeSync(bytes);
  }

  private clearLine() {
    Deno.stderr.writeSync(new TextEncoder().encode(`\r\x1b[K`));
  }

  private log(msg: string) {
    Deno.stderr.writeSync(new TextEncoder().encode(msg + "\n"));
  }

  private elapsed(since: number): string {
    const ms = Math.round(performance.now() - since);
    if (ms < 1000) return `(${ms}ms)`;
    return `(${(ms / 1000).toFixed(1)}s)`;
  }
}

// Extract --runtime flag before command parsing
const rawArgs = [...Deno.args];
let runtime = "extension"; // default
const rtIdx = rawArgs.indexOf("--runtime");
if (rtIdx !== -1 && rawArgs[rtIdx + 1]) {
  runtime = rawArgs[rtIdx + 1];
  rawArgs.splice(rtIdx, 2);
}

const args = rawArgs;
const command = args[0];

if (!command || command === "-h" || command === "--help" || command === "help") {
  console.log(`tap — universal protocol for AI to operate any interface

Usage:
  tap list                          list all available taps
  tap <site> <name> [--arg value]   run a tap
  tap daemon                        start bridge daemon
  tap mcp                           start MCP server (stdin/stdout)

Options:
  --runtime extension               use Chrome Extension kernel (default)
  --runtime playwright              use Playwright kernel (headless capable)

Examples:
  tap weibo hot                     微博热搜
  tap github trending               GitHub trending repos
  tap --runtime playwright github trending    headless mode
  tap xiaohongshu search --keyword "AI"

Run 'tap list' to see all available taps and their arguments.`);
  Deno.exit(0);
}

switch (command) {
  case "list":
    await cmdList();
    break;
  case "daemon":
    await cmdDaemon();
    break;
  case "mcp":
    await cmdMcp();
    break;
  default:
    // tap <site> — list taps for that site
    if (args.length < 2) {
      const site = args[0];
      const dirs = tapDirs();
      const allTaps = await listTaps(dirs);
      const siteTaps = allTaps.filter((t) => t.site === site);
      if (siteTaps.length === 0) {
        console.error(`No taps found for site "${site}". Run 'tap list' to see all.`);
        Deno.exit(1);
      }
      console.log(`Available taps for ${site}:\n`);
      for (const t of siteTaps) {
        const argStr = t.args ? Object.keys(t.args).map((k) => `--${k}`).join(" ") : "";
        console.log(`  tap ${t.site} ${t.name} ${argStr}`.trimEnd());
        if (t.description) console.log(`      ${t.description}`);
      }
      Deno.exit(0);
    }
    await cmdTap(args[0], args[1], parseArgs(args.slice(2)));
    break;
}

// --- Commands ---

async function cmdList(): Promise<void> {
  const dirs = tapDirs();
  const taps = await listTaps(dirs);

  if (taps.length === 0) {
    console.log("No taps found.");
    return;
  }

  // Table output
  const siteW = Math.max(4, ...taps.map((t) => t.site.length));
  const nameW = Math.max(4, ...taps.map((t) => t.name.length));
  const header = `${"site".padEnd(siteW)}  ${"name".padEnd(nameW)}  description`;
  const sep = `${"-".repeat(siteW)}  ${"-".repeat(nameW)}  ${"-".repeat(40)}`;
  console.log(header);
  console.log(sep);
  for (const t of taps) {
    console.log(
      `${t.site.padEnd(siteW)}  ${t.name.padEnd(nameW)}  ${t.description || ""}`,
    );
  }
}

async function cmdDaemon(): Promise<void> {
  const handle = await startDaemon();
  console.error(`daemon: extension=${EXTENSION_PORT}, clients=${CLIENT_PORT}`);

  // Keep running until signal
  const signal = Deno.addSignalListener
    ? new Promise<void>((resolve) => {
        Deno.addSignalListener("SIGINT", () => resolve());
        Deno.addSignalListener("SIGTERM", () => resolve());
      })
    : new Promise<void>(() => {}); // Never resolves — keeps running

  await signal;
  await handle.stop();
}

async function cmdMcp(): Promise<void> {
  let client: BridgeClient | null = null;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const buf = new Uint8Array(65536);

  // Read lines from stdin
  let buffer = "";
  while (true) {
    const n = await Deno.stdin.read(buf);
    if (n === null) break; // EOF

    buffer += decoder.decode(buf.subarray(0, n));
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request;
      try {
        request = JSON.parse(trimmed);
      } catch {
        await writeStdout(encoder, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "parse error" },
        });
        continue;
      }

      const id = request.id;
      const method = request.method || "";

      let response;
      switch (method) {
        case "initialize":
          response = handleInitialize(id);
          break;
        case "notifications/initialized":
          continue;
        case "tools/list":
          response = handleToolsList(id);
          break;
        case "resources/list":
          response = handleResourcesList(id);
          break;
        case "prompts/list":
          response = handlePromptsList(id);
          break;
        case "prompts/get":
          response = handlePromptsGet(id, request.params || {});
          break;
        case "tools/call": {
          // Lazy-connect to daemon
          if (!client) {
            try {
              client = await connectToDaemon();
            } catch (e) {
              response = {
                jsonrpc: "2.0",
                id,
                result: {
                  content: [{ type: "text", text: `error: ${e}` }],
                  isError: true,
                },
              };
              break;
            }
          }
          response = await handleToolCall(id, request.params, client);
          break;
        }
        default:
          response = {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `method not found: ${method}` },
          };
      }

      if (response) {
        await writeStdout(encoder, response);
      }
    }
  }
}

async function cmdTap(
  site: string,
  name: string,
  tapArgs: Record<string, unknown>,
): Promise<void> {
  const status = new StatusLine();
  status.start(`${site}/${name} [${runtime}] — connecting`);

  // Find tap on disk
  const dirs = tapDirs();
  let tapPath = "";
  for (const dir of dirs) {
    const p = `${dir}/${site}/${name}.tap.js`;
    try { await Deno.stat(p); tapPath = p; break; } catch { /* next */ }
  }
  if (!tapPath) { status.fail(`tap not found: ${site}/${name}`); Deno.exit(1); }

  const tap = await loadTap(tapPath);

  if (runtime === "playwright") {
    // --- Playwright runtime: no daemon/extension needed ---
    const { createPlaywrightRuntime } = await import("./runtime-playwright.ts");
    const rt = await createPlaywrightRuntime({ headless: tapArgs.headless === true || tapArgs.headless === "true" });
    try {
      status.update(`${site}/${name} — running`);
      const send: RpcSend = (_type, method, params) => {
        const label = formatStep(_type, method, params);
        status.update(label);
        return rt.send(_type, method, params);
      };
      const result = await runTap(tap, tapArgs, send);
      status.done(`${site}/${name} — ${result.count} row(s)`);
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      status.fail(`${site}/${name} — ${e}`);
      Deno.exit(1);
    } finally {
      await rt.close();
    }
  } else {
    // --- Extension runtime: connect through daemon ---
    const client = await connectToDaemon();
    try {
      status.update(`${site}/${name} — running`);
      const send: RpcSend = (type, method, params) => {
        const label = formatStep(type, method, params);
        status.update(label);
        return client.sendTap(type, method, params) as Promise<unknown>;
      };
      const result = await runTap(tap, tapArgs, send);
      status.done(`${site}/${name} — ${result.count} row(s)`);
      console.log(JSON.stringify(result, null, 2));
    } catch (e) {
      status.fail(`${site}/${name} — ${e}`);
      Deno.exit(1);
    } finally {
      client.close();
    }
  }
}

/** Human-readable label for an RPC step. */
function formatStep(type: string, method: string, params: Record<string, unknown>): string {
  // CDP kernel methods
  if (method === "Page.navigate") {
    const url = String(params.url || "");
    try { return `nav ${new URL(url).hostname}`; } catch { return `nav ${url.slice(0, 50)}`; }
  }
  if (method === "Runtime.evaluate") {
    const expr = String(params.expression || "");
    if (expr.startsWith("(async") || expr.startsWith("((")) return `extract`;
    return `eval`;
  }
  if (method === "Page.captureScreenshot") return `screenshot`;
  if (method === "Input.dispatchMouseEvent") return `pointer ${params.x},${params.y}`;
  if (method === "Input.dispatchKeyEvent") return `key ${params.key || ""}`;
  // Tool commands
  if (method === "run") return `tap ${params.site}/${params.name}`;
  if (method === "click") return `click "${params.target || ""}"`;
  if (method === "type") return `type → ${String(params.selector || "").slice(0, 30)}`;
  if (method === "upload") return `upload → ${String(params.selector || "").slice(0, 30)}`;
  if (method === "waitFor") return `waitFor "${params.selector || ""}"`;
  if (method === "find") return `find "${params.query || ""}"`;
  if (method === "fetch") {
    try { return `fetch ${new URL(String(params.url)).hostname}`; } catch { return `fetch`; }
  }
  return `${type}/${method}`;
}

// --- MCP tool dispatch ---

async function handleToolCall(
  id: unknown,
  params: Record<string, unknown>,
  client: BridgeClient,
): Promise<Record<string, unknown>> {
  const toolName = (params.name as string) || "";
  const args = (params.arguments as Record<string, unknown>) || {};

  try {
    const result = await executeToolCall(toolName, args, client);
    const text = typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

    return {
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text }] },
    };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: `error: ${e}` }],
        isError: true,
      },
    };
  }
}

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  client: BridgeClient,
): Promise<unknown> {
  const tabId = (args.tabId as number) ?? -1;

  switch (name) {
    // Tools with local logic
    case "tap.list": {
      const dirs = tapDirs();
      const taps = await listTaps(dirs);
      return { taps: taps.map(t => ({ site: t.site, name: t.name, description: t.description, columns: t.columns, args: t.args })) };
    }
    case "tap.run": {
      const site = args.site as string;
      const tapName = args.name as string;
      const tapArgs = (args.args as Record<string, unknown>) || {};

      // Find and load tap from disk
      const dirs = tapDirs();
      let tapPath = "";
      for (const dir of dirs) {
        const p = `${dir}/${site}/${tapName}.tap.js`;
        try { await Deno.stat(p); tapPath = p; break; } catch { /* next */ }
      }
      if (!tapPath) {
        throw new Error(`tap not found: ${site}/${tapName}`);
      }

      const tap = await loadTap(tapPath);

      // Create RPC send that routes through bridge to extension kernel
      const send: RpcSend = (type, method, params) => {
        return client.sendTap(type, method, params, tabId) as Promise<unknown>;
      };

      return await runTap(tap, tapArgs, send);
    }
    case "tap.screenshot": {
      const result = await client.sendTap("cdp", "Page.captureScreenshot", {
        format: args.format || "jpeg",
        quality: args.quality || 50,
      }, tabId) as Record<string, unknown>;
      const data = result.data as string;
      if (data) {
        const path = (args.path as string) || `${tapHome()}/cache/screenshot.jpg`;
        await Deno.mkdir(new URL(".", `file://${path}`).pathname, { recursive: true }).catch(() => {});
        await Deno.writeFile(path, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
        return `Screenshot saved to ${path}`;
      }
      return result;
    }
    case "tap.logs": {
      const logPath = `${tapHome()}/logs/tap.jsonl`;
      try {
        const content = await Deno.readTextFile(logPath);
        const lines = content.trim().split("\n").filter(Boolean);
        const limit = (args.limit as number) || 50;
        return lines.slice(-limit).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    }
    case "forge.inspect": {
      const url = args.url as string || "";
      const send: RpcSend = (type, method, params) =>
        client.sendTap(type, method, params, tabId) as Promise<unknown>;
      return await forgeInspect(url, send);
    }
    case "forge.verify": {
      const url = args.url as string;
      await client.sendTap("cdp", "Page.navigate", { url }, tabId);
      await new Promise((r) => setTimeout(r, (args.wait_ms as number) || 2000));
      return await client.sendTap("cdp", "Runtime.evaluate", {
        expression: args.expression,
        returnByValue: true,
      }, tabId);
    }
    case "forge.save": {
      const site = args.site as string;
      const tapName = args.name as string;
      const code = args.code as string;
      const dir = `${tapHome()}/taps/${site}`;
      await Deno.mkdir(dir, { recursive: true });
      const path = `${dir}/${tapName}.tap.js`;
      await Deno.writeTextFile(path, code);
      return `saved to ${path}`;
    }
    default: {
      // Relay to extension: page.click → tool/click, tab.list → tool/tab_list
      const method = convertToolName(name);
      return await client.sendTap("tool", method, args, tabId);
    }
  }
}

/** Convert MCP dot notation to extension method name. */
function convertToolName(name: string): string {
  const dot = name.indexOf(".");
  if (dot < 0) return name;
  const prefix = name.substring(0, dot);
  const action = name.substring(dot + 1);
  if (prefix === "page") return action; // page.click → click
  return `${prefix}_${action}`; // tab.list → tab_list
}

// --- Helpers ---

function tapHome(): string {
  return Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
}

function tapDirs(): string[] {
  const dirs = [`${tapHome()}/taps`];
  // Dev environment: also scan extension/taps relative to source
  const scriptDir = new URL(".", import.meta.url).pathname;
  const extTaps = `${scriptDir}../extension/taps`;
  try {
    Deno.statSync(extTaps);
    dirs.push(extTaps);
  } catch { /* not in dev environment */ }
  return dirs;
}

function parseArgs(raw: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < raw.length) {
    const key = raw[i].replace(/^--/, "");
    if (raw[i].startsWith("--") && i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
      const val = raw[i + 1];
      const num = Number(val);
      result[key] = isNaN(num) ? val : num;
      i += 2;
    } else if (raw[i].startsWith("--")) {
      result[key] = true;
      i += 1;
    } else {
      i += 1;
    }
  }
  return result;
}

async function writeStdout(
  encoder: TextEncoder,
  obj: unknown,
): Promise<void> {
  const bytes = encoder.encode(JSON.stringify(obj) + "\n");
  await Deno.stdout.write(bytes);
}
