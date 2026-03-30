/**
 * End-to-end tap execution tests.
 * Requires: daemon running + Chrome extension connected.
 *
 * Run: deno test --no-check --allow-all src/test/e2e_test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BridgeClient } from "../bridge.ts";
import { CLIENT_PORT } from "../daemon.ts";
import { runTap, loadTap, listTaps } from "../executor.ts";
import { type RpcSend } from "../page.ts";

const TAP_DIRS = [
  `${Deno.env.get("HOME")}/.tap/taps`,
];

async function findTapPath(site: string, name: string): Promise<string | null> {
  for (const dir of TAP_DIRS) {
    const path = `${dir}/${site}/${name}.tap.js`;
    try {
      await Deno.stat(path);
      return path;
    } catch {
      // continue
    }
  }
  return null;
}

async function isDaemonReady(): Promise<boolean> {
  try {
    const client = new BridgeClient(`ws://127.0.0.1:${CLIENT_PORT}`);
    await client.waitReady();
    // Try a simple command to verify Chrome is connected
    try {
      await client.sendTap("tool", "inspect.page", {});
      client.close();
      return true;
    } catch {
      client.close();
      return false;
    }
  } catch {
    return false;
  }
}

async function runTapTest(
  site: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ReturnType<typeof runTap>> {
  const tapPath = await findTapPath(site, name);
  if (!tapPath) {
    throw new Error(`tap not found: ${site}/${name}`);
  }
  const tap = await loadTap(tapPath);
  
  const client = new BridgeClient(`ws://127.0.0.1:${CLIENT_PORT}`);
  await client.waitReady();
  try {
    const send: RpcSend = (type, method, params) => {
      return client.sendTap(type, method, params) as Promise<unknown>;
    };
    const result = await runTap(tap, args, send, TAP_DIRS);
    return result;
  } finally {
    client.close();
  }
}

Deno.test({
  name: "[e2e] can list taps from ~/.tap/taps",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const taps = await listTaps(TAP_DIRS);
    assertEquals(taps.length >= 1, true, `expected at least 1 tap, got ${taps.length}`);
    const names = taps.map(t => `${t.site}/${t.name}`);
    assertEquals(names.includes("github/trending"), true);
  },
});

// These tests require full runtime (daemon + Chrome with debugging)
// They are skipped if the environment isn't set up

Deno.test({
  name: "[e2e] github/trending — API tap returns rows (requires runtime)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tapPath = await findTapPath("github", "trending");
    if (!tapPath) {
      console.log("SKIP: github/trending tap not found in ~/.tap/taps");
      return;
    }
    const ready = await isDaemonReady();
    if (!ready) {
      console.log("SKIP: daemon not running (needs Chrome with --remote-debugging-port=9222)");
      return;
    }
    const r = await runTapTest("github", "trending");
    assertEquals(r.count >= 3, true, `github/trending: ${r.count} rows`);
  },
});

Deno.test({
  name: "[e2e] weibo/hot — API tap returns rows (requires runtime)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tapPath = await findTapPath("weibo", "hot");
    if (!tapPath) {
      console.log("SKIP: weibo/hot tap not found in ~/.tap/taps");
      return;
    }
    const ready = await isDaemonReady();
    if (!ready) {
      console.log("SKIP: daemon not running (needs Chrome with --remote-debugging-port=9222)");
      return;
    }
    const r = await runTapTest("weibo", "hot");
    assertEquals(r.count >= 3, true, `weibo/hot: ${r.count} rows`);
    assertEquals(Array.isArray(r.columns), true);
    assertEquals(Array.isArray(r.rows), true);
  },
});

Deno.test({
  name: "[e2e] dictionary/search — API tap with args (requires runtime)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tapPath = await findTapPath("dictionary", "search");
    if (!tapPath) {
      console.log("SKIP: dictionary/search tap not found in ~/.tap/taps");
      return;
    }
    const ready = await isDaemonReady();
    if (!ready) {
      console.log("SKIP: daemon not running (needs Chrome with --remote-debugging-port=9222)");
      return;
    }
    const r = await runTapTest("dictionary", "search", { query: "hello" });
    assertEquals(r.count >= 1, true, `dictionary/search: ${r.count} rows`);
  },
});

Deno.test({
  name: "[e2e] hackernews/hot — extract tap returns rows (requires runtime)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tapPath = await findTapPath("hackernews", "hot");
    if (!tapPath) {
      console.log("SKIP: hackernews/hot tap not found in ~/.tap/taps");
      return;
    }
    const ready = await isDaemonReady();
    if (!ready) {
      console.log("SKIP: daemon not running (needs Chrome with --remote-debugging-port=9222)");
      return;
    }
    const r = await runTapTest("hackernews", "hot");
    assertEquals(r.count >= 1, true, `hackernews/hot: ${r.count} rows`);
    assertEquals(typeof r.timing.total_ms, "number");
  },
});

Deno.test({
  name: "[e2e] tap result has correct structure (requires runtime)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const tapPath = await findTapPath("weibo", "hot");
    if (!tapPath) {
      console.log("SKIP: weibo/hot tap not found in ~/.tap/taps");
      return;
    }
    const ready = await isDaemonReady();
    if (!ready) {
      console.log("SKIP: daemon not running (needs Chrome with --remote-debugging-port=9222)");
      return;
    }
    const r = await runTapTest("weibo", "hot");
    assertEquals(Array.isArray(r.columns), true, "must have columns array");
    assertEquals(Array.isArray(r.rows), true, "must have rows array");
    assertEquals(typeof r.count, "number", "must have count number");
    assertEquals(typeof r.timing, "object", "must have timing object");
    if (r.rows.length > 0) {
      for (const [k, v] of Object.entries(r.rows[0])) {
        assertEquals(typeof v, "string", `row value for "${k}" must be string`);
      }
    }
  },
});
