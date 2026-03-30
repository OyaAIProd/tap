/**
 * End-to-end tap execution tests.
 * Requires: daemon running + Chrome extension connected.
 *
 * Run: deno test --no-check --allow-all deno/test/e2e_test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { BridgeClient } from "../bridge.ts";
import { CLIENT_PORT } from "../daemon.ts";

async function runTap(
  site: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const client = new BridgeClient(`ws://127.0.0.1:${CLIENT_PORT}`);
  await client.waitReady();
  try {
    const result = (await client.sendTap("tool", "run", {
      site,
      name,
      args,
    })) as Record<string, unknown>;
    return result;
  } finally {
    client.close();
  }
}

// --- API-based taps: fast, reliable (no page navigation) ---

Deno.test({
  name: "[e2e] weibo/hot — API tap returns rows",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await runTap("weibo", "hot");
    assertEquals((r.count as number) >= 3, true, `weibo/hot: ${r.count} rows`);
    assertEquals(Array.isArray(r.columns), true);
    assertEquals(Array.isArray(r.rows), true);
  },
});

Deno.test({
  name: "[e2e] github/trending — API tap returns rows",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await runTap("github", "trending");
    assertEquals((r.count as number) >= 3, true, `github/trending: ${r.count} rows`);
  },
});

Deno.test({
  name: "[e2e] dictionary/search — API tap with args",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await runTap("dictionary", "search", { query: "hello" });
    assertEquals((r.count as number) >= 1, true, `dictionary/search: ${r.count} rows`);
  },
});

// --- Extract-format tap: navigates page, slower but must work ---

Deno.test({
  name: "[e2e] hackernews/hot — extract tap returns rows",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await runTap("hackernews", "hot");
    assertEquals((r.count as number) >= 1, true, `hackernews/hot: ${r.count} rows`);
    // Verify timing data exists
    const timing = r.timing as Record<string, unknown>;
    assertEquals(typeof timing.total_ms, "number");
  },
});

// --- Structural: result format ---

Deno.test({
  name: "[e2e] tap result has correct structure (columns, rows, count, timing)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const r = await runTap("weibo", "hot");
    assertEquals(Array.isArray(r.columns), true, "must have columns array");
    assertEquals(Array.isArray(r.rows), true, "must have rows array");
    assertEquals(typeof r.count, "number", "must have count number");
    assertEquals(typeof r.timing, "object", "must have timing object");
    // All row values should be strings
    const rows = r.rows as Record<string, unknown>[];
    if (rows.length > 0) {
      for (const [k, v] of Object.entries(rows[0])) {
        assertEquals(typeof v, "string", `row value for "${k}" must be string`);
      }
    }
  },
});
