#!/usr/bin/env -S deno run --allow-all --no-check
/**
 * Tap CLI — entry point for all commands.
 *
 * Usage:
 *   tap list                     — list available taps
 *   tap update                   — update everything (core + skills + runtimes)
 *   tap update                   — update community skills
 *   tap daemon                   — run bridge daemon (foreground)
 *   tap mcp                      — run MCP server (stdin/stdout)
 *   tap <site> <name> [--args]   — run a tap
 */

export const VERSION = "0.4.0";

import { startDaemon, EXTENSION_PORT, CLIENT_PORT } from "./daemon.ts";
import { connectToDaemon, BridgeClient, isDaemonRunning } from "./bridge.ts";
import { listTaps, loadTap, runTap, appendLog } from "./executor.ts";
import { createPageProxy, type RpcSend } from "./page.ts";
import { forgeInspect, forgeVerify, checkTapQuality } from "./forge.ts";
import { handleInspectTool } from "./inspect.ts";
import { handleInitialize, handleToolsList, handlePromptsList, handlePromptsGet, handleResourcesList, buildToolsSchema } from "./mcp.ts";

// --- Constants ---

const TARGETS: Record<string, string> = {
  "darwin-aarch64": "aarch64-apple-darwin",
  "darwin-x86_64": "x86_64-apple-darwin",
  "linux-x86_64": "x86_64-unknown-linux-gnu",
  "windows-x86_64": "x86_64-pc-windows-msvc",
};

const REPO_API = "https://api.github.com/repos/LeonTing1010/tap/releases/latest";

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

  clear() {
    if (isTTY) {
      this.clearLine();
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }
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

if (command === "-v" || command === "--version" || command === "version") {
  console.log(`tap ${VERSION}`);
  Deno.exit(0);
}

if (!command || command === "-h" || command === "--help" || command === "help") {
  console.log(`tap — universal protocol for AI to operate any interface

Usage:
  tap list                          list all available taps
  tap <site> <name> [--arg value]   run a tap
  tap <site> <name> --json          output JSON lines (for piping)
  tap <site> <name> --stdin         read rows from stdin (pipeline input)
  tap daemon                        start bridge daemon (foreground)
  tap daemon stop                   stop running daemon
  tap daemon restart                restart daemon (background)
  tap daemon status                 check daemon status
  tap doctor                        diagnose setup issues
  tap update                        update everything (core + skills + runtimes)
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
  case "update":
    await cmdUpdate();
    break;
  case "daemon":
    await cmdDaemon(args[1]);
    break;
  case "doctor":
    await cmdDoctor();
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

// --- Shared helpers ---

/** Find a tap on disk, returns path or throws. */
async function findTap(site: string, name: string, dirs: string[]): Promise<string> {
  for (const dir of dirs) {
    const p = `${dir}/${site}/${name}.tap.js`;
    try { await Deno.stat(p); return p; } catch { /* next */ }
  }
  throw new Error(`tap not found: ${site}/${name}`);
}

/** Create RpcSend from bridge client + tabId. */
function createBridgeSend(client: BridgeClient, tabId: number): RpcSend {
  return (type, method, params) =>
    client.sendTap(type, method, params, tabId) as Promise<unknown>;
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

const SKILLS_REPO = "https://github.com/LeonTing1010/tap-skills.git";

/**
 * tap update — update everything: core code, CLI binary, skills, active runtimes.
 * Runtime reload is broadcast via daemon — each runtime decides how to reload.
 * CLI doesn't know or care what runtimes are connected.
 */
async function cmdUpdate(): Promise<void> {
  const steps: { name: string; ok: boolean; detail: string }[] = [];
  const platform = `${Deno.build.os}-${Deno.build.arch}`;
  const target = TARGETS[platform];

  // 1. Core — check version, download if newer
  if (!target) {
    steps.push({ name: "core", ok: false, detail: `unsupported: ${platform}` });
  } else {
    let latest = "";
    try {
      const { stdout } = await new Deno.Command("curl", {
        args: ["-fsSL", REPO_API], stdout: "piped", stderr: "piped",
      }).output();
      latest = (JSON.parse(new TextDecoder().decode(stdout)).tag_name as string || "").replace(/^v/, "");
    } catch {}

    if (!latest) {
      steps.push({ name: "core", ok: false, detail: "cannot reach GitHub" });
    } else if (!semverGt(latest, VERSION)) {
      steps.push({ name: "core", ok: true, detail: `v${VERSION} (latest)` });
    } else {
      // Download binary + extension
      const asset = `tap-${target}.tar.gz`;
      const binPath = Deno.execPath();
      const tmpDir = await Deno.makeTempDir();
      try {
        const baseUrl = `https://github.com/LeonTing1010/tap/releases/download/v${latest}`;
        const { code, stderr } = await new Deno.Command("sh", {
          args: ["-c", `cd "${tmpDir}" && curl -fsSL -o "${asset}" "${baseUrl}/${asset}" && tar -xzf "${asset}" && rm -f "${binPath}" && mv tap "${binPath}" && chmod +x "${binPath}"`],
          stdout: "piped", stderr: "piped",
        }).output();

        if (code === 0) {
          // Update extension
          const extDir = `${tapHome()}/extension`;
          await new Deno.Command("sh", {
            args: ["-c", `curl -fsSL -o "${tmpDir}/ext.zip" "${baseUrl}/tap-extension.zip" && rm -rf "${extDir}" && mkdir -p "${extDir}" && cd "${extDir}" && unzip -qo "${tmpDir}/ext.zip"`],
            stdout: "piped", stderr: "piped",
          }).output();
          steps.push({ name: "core", ok: true, detail: `v${VERSION} → v${latest}` });
        } else {
          const errDetail = new TextDecoder().decode(stderr).trim().split("\n").pop() || "download failed";
          steps.push({ name: "core", ok: false, detail: errDetail });
        }
      } finally {
        await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
      }
    }
  }

  // 2. Skills — clone if missing, pull if exists
  const skillsDir = `${tapHome()}/skills`;
  try {
    let exists = false;
    try { await Deno.stat(skillsDir); exists = true; } catch {}
    if (exists) {
      const { code, stdout } = await new Deno.Command("git", {
        args: ["-C", skillsDir, "pull", "--ff-only"], stdout: "piped", stderr: "piped",
      }).output();
      steps.push({ name: "skills", ok: code === 0, detail: new TextDecoder().decode(stdout).trim() || "up to date" });
    } else {
      const { code } = await new Deno.Command("git", {
        args: ["clone", "--depth", "1", SKILLS_REPO, skillsDir], stdout: "piped", stderr: "piped",
      }).output();
      const taps = await listTaps(tapDirs());
      steps.push({ name: "skills", ok: code === 0, detail: `installed ${taps.length} skills` });
    }
  } catch (e) {
    steps.push({ name: "skills", ok: false, detail: String(e) });
  }

  // 3. Runtimes — broadcast reload
  try {
    const { connectToDaemon } = await import("./bridge.ts");
    const bridge = await connectToDaemon();
    const result = await bridge.sendTap("bridge", "reload", {}) as Record<string, unknown>;
    bridge.close();
    steps.push({ name: "runtimes", ok: true, detail: String(result.reloaded || "broadcast sent") });
  } catch {
    steps.push({ name: "runtimes", ok: true, detail: "daemon not running (skip)" });
  }

  // Summary
  console.log("tap update:");
  for (const s of steps) {
    console.log(`  ${s.ok ? "✓" : "✗"} ${s.name}: ${s.detail}`);
  }
}

/** Kill any process listening on the daemon ports. */
async function killDaemon(): Promise<boolean> {
  let killed = false;
  for (const port of [EXTENSION_PORT, CLIENT_PORT]) {
    try {
      const cmd = new Deno.Command("lsof", { args: ["-ti", `:${port}`], stdout: "piped", stderr: "null" });
      const { stdout } = await cmd.output();
      const pids = new TextDecoder().decode(stdout).trim().split("\n").filter(Boolean);
      for (const pid of pids) {
        try { Deno.kill(Number(pid), "SIGTERM"); killed = true; } catch { /* already gone */ }
      }
    } catch { /* lsof not found or no process */ }
  }
  if (killed) await new Promise((r) => setTimeout(r, 300));
  return killed;
}

/** Start daemon in background (detached). */
async function forkDaemonBackground(): Promise<void> {
  // Detect compiled binary vs deno run
  const exe = Deno.execPath();
  const isCompiled = !exe.endsWith("/deno") && !exe.endsWith("/deno.exe");
  let cmd: Deno.Command;
  if (isCompiled) {
    // Compiled binary: just re-run ourselves with "daemon"
    cmd = new Deno.Command(exe, {
      args: ["daemon"],
      stdin: "null", stdout: "null", stderr: "null",
    });
  } else {
    // Dev mode: use deno run
    const script = new URL("./cli.ts", import.meta.url).pathname;
    cmd = new Deno.Command(exe, {
      args: ["run", "--allow-all", "--no-check", script, "daemon"],
      stdin: "null", stdout: "null", stderr: "null",
    });
  }
  const child = cmd.spawn();
  child.unref();
  await new Promise((r) => setTimeout(r, 500));
}

async function cmdDaemon(sub?: string): Promise<void> {
  switch (sub) {
    case "stop": {
      const killed = await killDaemon();
      console.log(killed ? "daemon stopped" : "daemon not running");
      return;
    }
    case "restart": {
      await killDaemon();
      await forkDaemonBackground();
      // Verify it started
      const running = await isDaemonRunning();
      console.log(running ? "daemon restarted" : "daemon failed to start — check ~/.tap/logs/daemon.log");
      return;
    }
    case "status": {
      const running = await isDaemonRunning();
      if (running) {
        console.log(`daemon running (extension=:${EXTENSION_PORT}, clients=:${CLIENT_PORT})`);
      } else {
        console.log("daemon not running");
      }
      return;
    }
  }

  // Default: foreground start
  const dirs = tapDirs();

  const handle = await startDaemon({
    onExtensionRequest: async (msg, sendToExtension) => {
      const { method, params } = msg;
      switch (method) {
        case "list": {
          const taps = await listTaps(dirs);
          return { taps: taps.map((t) => ({ site: t.site, name: t.name, description: t.description })), count: taps.length };
        }
        case "run": {
          const site = params.site as string;
          const name = params.name as string;
          const tapArgs = (params.args as Record<string, unknown>) || {};
          const tapPath = await findTap(site, name, dirs);
          const tap = await loadTap(tapPath);
          return await runTap(tap, tapArgs, sendToExtension, dirs);
        }
        default:
          throw new Error(`unknown extension request: ${method}`);
      }
    },
  });
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

async function cmdDoctor(): Promise<void> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];

  // 1. Skills installed?
  const dirs = tapDirs();
  const taps = await listTaps(dirs);
  checks.push({
    name: "skills",
    ok: taps.length > 0,
    detail: taps.length > 0 ? `${taps.length} taps available` : "none — run 'tap update'",
  });

  // 2. Daemon running?
  const daemonOk = await isDaemonRunning();
  checks.push({
    name: "daemon",
    ok: daemonOk,
    detail: daemonOk ? `running (:${EXTENSION_PORT}/:${CLIENT_PORT})` : "not running — run 'tap daemon'",
  });

  // 3. Extension connected?
  let extOk = false;
  if (daemonOk) {
    try {
      const client = new BridgeClient(`ws://127.0.0.1:${CLIENT_PORT}`);
      await client.waitReady();
      await client.sendTap("tool", "page.capabilities", {});
      extOk = true;
      client.close();
    } catch { /* not connected */ }
  }
  checks.push({
    name: "extension",
    ok: extOk,
    detail: extOk ? "connected" : "not connected — load extension in Chrome",
  });

  // Print
  for (const c of checks) {
    console.log(`${c.ok ? "✔" : "✘"} ${c.name.padEnd(12)} ${c.detail}`);
  }
  const allOk = checks.every((c) => c.ok);
  if (allOk) {
    console.log("\nAll good. Ready to tap.");
  } else {
    console.log("\nSome issues found. Fix them and run 'tap doctor' again.");
    Deno.exit(1);
  }
}

async function cmdMcp(): Promise<void> {
  let client: BridgeClient | null = null;
  let sessionTabId = -1; // Track active tab across tool calls

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
          const callResult = await handleToolCall(id, request.params, client, sessionTabId);
          response = callResult.response;
          if (callResult.tabId >= 0) sessionTabId = callResult.tabId;
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
  const jsonOutput = tapArgs.json === true;
  const stdinInput = tapArgs.stdin === true;
  delete tapArgs.json;
  delete tapArgs.stdin;

  // Read upstream rows from stdin for pipeline composition
  if (stdinInput) {
    const buf = new Uint8Array(1024 * 1024);
    const chunks: string[] = [];
    let n: number | null;
    while ((n = await Deno.stdin.read(buf)) !== null) {
      chunks.push(new TextDecoder().decode(buf.subarray(0, n)));
    }
    const text = chunks.join("").trim();
    if (text) {
      try { tapArgs.rows = JSON.parse(text); }
      catch { tapArgs.rows = text.split("\n").filter(Boolean).map(l => JSON.parse(l)); }
    }
  }

  const status = new StatusLine();
  if (!jsonOutput) status.start(`${site}/${name} [${runtime}] — connecting`);

  const dirs = tapDirs();
  let tapPath: string;
  try {
    tapPath = await findTap(site, name, dirs);
  } catch {
    if (!jsonOutput) status.fail(`tap not found: ${site}/${name}`);
    else console.error(`tap not found: ${site}/${name}`);
    Deno.exit(1);
  }

  const tap = await loadTap(tapPath);

  // Create runtime-specific send + cleanup, then run uniformly
  let send: RpcSend;
  let cleanup: () => Promise<void> = async () => {};

  if (runtime === "playwright") {
    const { createPlaywrightRuntime } = await import("./runtime-playwright.ts");
    const rt = await createPlaywrightRuntime({ headless: tapArgs.headless === true || tapArgs.headless === "true" });
    send = (_type, method, params) => rt.send(_type, method, params);
    cleanup = () => rt.close();
  } else if (runtime === "macos") {
    const { createMacOSRuntime } = await import("./runtime-macos.ts");
    const rt = await createMacOSRuntime({ app: tapArgs.app as string });
    send = (_type, method, params) => rt.send(_type, method, params);
    cleanup = () => rt.close();
  } else {
    const client = await connectToDaemon();
    send = (type, method, params) => client.sendTap(type, method, params) as Promise<unknown>;
    cleanup = async () => client.close();
  }

  // Wrap send with status updates
  const trackedSend: RpcSend = (type, method, params) => {
    if (!jsonOutput) status.update(formatStep(type, method, params));
    return send(type, method, params);
  };

  try {
    if (!jsonOutput) status.update(`${site}/${name} — running`);
    const result = await runTap(tap, tapArgs, trackedSend, dirs);
    if (jsonOutput) {
      status.clear();
      console.log(JSON.stringify(result.rawRows));
    } else {
      status.done(`${site}/${name} — ${result.count} row(s)`);
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    status.fail(`${site}/${name} — ${e}`);
    Deno.exit(1);
  } finally {
    await cleanup();
  }
}

/** Human-readable label for an RPC step. */
function formatStep(_type: string, method: string, params: Record<string, unknown>): string {
  if (method === "page.nav") {
    const url = String(params.url || "");
    try { return `nav ${new URL(url).hostname}`; } catch { return `nav ${url.slice(0, 50)}`; }
  }
  if (method === "page.eval") {
    const expr = String(params.expression || "");
    if (expr.startsWith("(async") || expr.startsWith("((")) return `extract`;
    return `eval`;
  }
  if (method === "page.screenshot") return `screenshot`;
  if (method === "page.pointer") return `pointer ${params.x},${params.y}`;
  if (method === "page.keyboard") return `key ${params.key || ""}`;
  if (method === "tap.run") return `tap ${params.site}/${params.name}`;
  if (method === "page.click") return `click "${params.target || ""}"`;
  if (method === "page.type") return `type → ${String(params.selector || "").slice(0, 30)}`;
  if (method === "page.upload") return `upload → ${String(params.selector || "").slice(0, 30)}`;
  if (method === "page.waitFor") return `waitFor "${params.selector || ""}"`;
  if (method === "page.find") return `find "${params.query || ""}"`;
  if (method === "page.fetch") {
    try { return `fetch ${new URL(String(params.url)).hostname}`; } catch { return `fetch`; }
  }
  return `${_type}/${method}`;
}

// --- MCP tool dispatch ---

async function handleToolCall(
  id: unknown,
  params: Record<string, unknown>,
  client: BridgeClient,
  sessionTabId: number,
): Promise<{ response: Record<string, unknown>; tabId: number }> {
  const toolName = (params.name as string) || "";
  const args = (params.arguments as Record<string, unknown>) || {};
  // Debug: log to file since stderr may not be visible
  try { Deno.writeTextFileSync(`${Deno.env.get("HOME")}/.tap/logs/mcp-debug.log`, `tool=${toolName}\n`, { append: true }); } catch {}

  try {
    const { result, tabId } = await executeToolCall(toolName, args, client, sessionTabId);
    const text = typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

    return {
      response: {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text }] },
      },
      tabId,
    };
  } catch (e) {
    const errMsg = String(e);
    // Reset session tab if it became invalid
    const resetTab = /No tab|tab.*closed|tab.*not found/i.test(errMsg);
    return {
      response: {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `error: ${e}` }],
          isError: true,
        },
      },
      tabId: resetTab ? -1 : sessionTabId,
    };
  }
}

// Tools that never need a browser tab — skip auto-allocation for these.
const TAB_FREE_TOOLS = new Set([
  "tap.list", "tap.logs", "tap.reload", "tap.version", "forge.save",
]);

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  client: BridgeClient,
  sessionTabId: number,
): Promise<{ result: unknown; tabId: number }> {
  // Explicit tabId in args > session tabId > -1 (let extension decide)
  let tabId = (args.tabId as number) ?? (sessionTabId >= 0 ? sessionTabId : -1);

  // Auto-allocate a tab for this session if needed (fd model: each session owns its tab)
  if (tabId < 0 && !TAB_FREE_TOOLS.has(name)) {
    const newTab = await client.sendTap("tool", "tab.new", {}) as Record<string, unknown>;
    tabId = (newTab?.tabId as number) ?? -1;
  }

  const wrap = (result: unknown, newTabId = tabId) => ({ result, tabId: newTabId });

  switch (name) {
    // Tools with local logic
    case "tap.list": {
      const dirs = tapDirs();
      const taps = await listTaps(dirs);
      return wrap({ taps: taps.map(t => ({ site: t.site, name: t.name, description: t.description, columns: t.columns, args: t.args })) });
    }
    case "tap.run": {
      const site = args.site as string;
      const tapName = args.name as string;
      const tapArgs = (args.args as Record<string, unknown>) || {};

      const dirs = tapDirs();
      const tapPath = await findTap(site, tapName, dirs);
      const tap = await loadTap(tapPath);
      const send = createBridgeSend(client, tabId);

      const result = await runTap(tap, tapArgs, send, dirs);
      return wrap({ ...result, tabId }, tabId);
    }
    case "tap.screenshot": {
      const send = createBridgeSend(client, tabId);
      const page = createPageProxy(send);
      const result = await page.screenshot({
        format: args.format || "jpeg",
        quality: args.quality || 50,
      }) as Record<string, unknown>;
      const data = result.data as string;
      if (data) {
        const path = (args.path as string) || `${tapHome()}/cache/screenshot.jpg`;
        await Deno.mkdir(new URL(".", `file://${path}`).pathname, { recursive: true }).catch(() => {});
        await Deno.writeFile(path, Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
        return wrap(`Screenshot saved to ${path}`);
      }
      return wrap(result);
    }
    case "tap.logs": {
      const logPath = `${tapHome()}/logs/tap.jsonl`;
      try {
        const content = await Deno.readTextFile(logPath);
        const lines = content.trim().split("\n").filter(Boolean);
        const limit = (args.limit as number) || 50;
        return wrap(lines.slice(-limit).map((l) => JSON.parse(l)));
      } catch {
        return wrap([]);
      }
    }
    case "forge.inspect": {
      const url = args.url as string || "";
      const t0 = performance.now();
      const send = createBridgeSend(client, tabId);
      const result = await forgeInspect(url, send, tapDirs());
      const strategies = (result as Record<string, unknown>)?.strategies;
      await appendLog({
        event: "forge_inspect", url,
        ms: Math.round(performance.now() - t0),
        strategies: Array.isArray(strategies) ? strategies.length : 0,
      });
      return wrap(result);
    }
    case "forge.verify": {
      const url = args.url as string;
      const t0 = performance.now();
      const send = createBridgeSend(client, tabId);
      const result = await forgeVerify(url, args.expression as string, send, (args.wait_ms as number) || 2000);
      await appendLog({
        event: "forge_verify", url,
        ms: Math.round(performance.now() - t0),
        ok: result.ok,
      });
      return wrap(result);
    }
    case "forge.save": {
      const site = args.site as string;
      const tapName = args.name as string;
      const code = args.code as string;
      const warnings = checkTapQuality(code);
      const dir = `${tapHome()}/taps/${site}`;
      await Deno.mkdir(dir, { recursive: true });
      const path = `${dir}/${tapName}.tap.js`;
      await Deno.writeTextFile(path, code);
      await appendLog({
        event: "forge_save", site, name: tapName, path,
        warnings: warnings.length,
      });
      return wrap({ saved: path, warnings });
    }
    // Inspect tools — eval-based, run in Deno via page.eval()
    case "inspect.page":
    case "inspect.element":
    case "inspect.a11y":
    case "inspect.dom":
    case "inspect.globals":
    case "inspect.download":
    case "inspect.apiLog":
    case "inspect.toasts": {
      const send = createBridgeSend(client, tabId);
      return wrap(await handleInspectTool(name, args, send));
    }
    case "tap.reload": {
      // Broadcast reload to all connected runtimes via daemon bridge
      const result = await client.sendTap("bridge", "reload", {});
      return wrap(result);
    }
    default: {
      // Relay to extension — name IS the wire method, no conversion
      const result = await client.sendTap("tool", name, args, tabId);
      // Track tabId from tab.new and page.nav responses
      const res = result as Record<string, unknown>;
      const newTabId = (res?.tabId as number) ?? tabId;
      return wrap(result, newTabId);
    }
  }
}


// --- Helpers ---

/** Returns true if a > b (semver, e.g. "0.4.0" > "0.3.0"). */
function semverGt(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return false;
  }
  return false;
}

function tapHome(): string {
  return Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`;
}

function tapDirs(): string[] {
  const home = tapHome();
  // User taps first (higher priority), then community skills
  const dirs = [`${home}/taps`, `${home}/skills`];
  return dirs.filter(d => { try { Deno.statSync(d); return true; } catch { return false; } });
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
