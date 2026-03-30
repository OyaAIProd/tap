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
import { listTaps } from "./executor.ts";
import { handleInitialize, handleToolsList, handlePromptsList, handlePromptsGet, handleResourcesList, buildToolsSchema } from "./mcp.ts";

const args = Deno.args;
const command = args[0];

if (!command) {
  console.log("usage: tap <list|daemon|mcp|site name> [--arg value ...]");
  Deno.exit(1);
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
    // tap <site> <name> [--args]
    if (args.length < 2) {
      console.error("usage: tap <site> <name> [--arg value ...]");
      Deno.exit(1);
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
  const client = await connectToDaemon();
  try {
    const result = await client.sendTap("tool", "run", {
      site,
      name,
      args: tapArgs,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(`error: ${e}`);
    Deno.exit(1);
  } finally {
    client.close();
  }
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
    case "tap.list":
      return await client.sendTap("tool", "list", {}, tabId);
    case "tap.run": {
      const site = args.site as string;
      const tapName = args.name as string;
      const tapArgs = (args.args as Record<string, unknown>) || {};
      return await client.sendTap("tool", "run", { site, name: tapName, args: tapArgs }, tabId);
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
      const url = args.url as string;
      if (url) {
        await client.sendTap("cdp", "Page.navigate", { url }, tabId);
      }
      return await client.sendTap("tool", "forge_inspect", {}, tabId);
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
  // Also check extension/taps relative to this script
  const scriptDir = new URL(".", import.meta.url).pathname;
  const extTaps = `${scriptDir}../extension/taps`;
  try {
    Deno.statSync(extTaps);
    dirs.push(extTaps);
  } catch {
    // Not in dev environment
  }
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
