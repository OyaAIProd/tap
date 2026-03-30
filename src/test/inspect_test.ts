/**
 * Constraint: Inspect tools (safety / what)
 * Why: inspect tools are how Claude sees the page. They must go through
 * page.eval() RPC, not extension-internal chrome.scripting.
 *
 * Run: deno test src/test/inspect_test.ts --no-check --allow-read
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleInspectTool } from "../inspect.ts";

// Mock send that records calls and returns canned responses
function mockSend(evalReturn: unknown = {}) {
  const calls: Array<{ type: string; method: string; params: Record<string, unknown> }> = [];
  const send = (type: string, method: string, params: Record<string, unknown>) => {
    calls.push({ type, method, params });
    if (method === "page.eval") return Promise.resolve(evalReturn);
    return Promise.resolve({});
  };
  return { send, calls };
}

// --- Safety: all inspect tools route through page.eval ---

const INSPECT_TOOLS = [
  "inspect.page",
  "inspect.element",
  "inspect.a11y",
  "inspect.dom",
  "inspect.globals",
  "inspect.download",
  "inspect.apiLog",
  "inspect.toasts",
];

for (const tool of INSPECT_TOOLS) {
  Deno.test(`[safety/what] ${tool} calls page.eval`, async () => {
    const args: Record<string, unknown> = {};
    if (tool === "inspect.element") args.selector = "#test";
    if (tool === "inspect.download") args.url = "https://example.com/file";

    const { send, calls } = mockSend({ test: true });
    await handleInspectTool(tool, args, send);

    assertEquals(
      calls.some((c) => c.method === "page.eval"),
      true,
      `${tool} must call page.eval`,
    );
    assertEquals(
      calls.every((c) => c.type === "tool"),
      true,
      `${tool} must use type "tool"`,
    );
  });
}

// --- Safety: argument injection prevention ---

Deno.test("[safety/what] inspect.element embeds selector via JSON.stringify", async () => {
  const { send, calls } = mockSend(null);
  await handleInspectTool("inspect.element", { selector: 'a[href="x"]' }, send);
  const expr = (calls[0].params as Record<string, unknown>).expression as string;
  // JSON.stringify produces escaped quotes — must appear in expression
  assertEquals(expr.includes('"a[href=\\"x\\"]"'), true, "selector must be JSON-escaped");
});

Deno.test("[safety/what] inspect.dom embeds all 3 args safely", async () => {
  const { send, calls } = mockSend(null);
  await handleInspectTool("inspect.dom", { selector: "div.test", depth: 3, summary: false }, send);
  const expr = (calls[0].params as Record<string, unknown>).expression as string;
  assertEquals(expr.includes('"div.test"'), true, "selector must be embedded");
  assertEquals(expr.includes("3"), true, "depth must be embedded");
  assertEquals(expr.includes("false"), true, "summary must be embedded");
});

// --- Safety: required args validation ---

Deno.test("[safety/what] inspect.element throws without selector", async () => {
  const { send } = mockSend();
  await assertRejects(() => handleInspectTool("inspect.element", {}, send), Error, "missing selector");
});

Deno.test("[safety/what] inspect.download throws without url", async () => {
  const { send } = mockSend();
  await assertRejects(() => handleInspectTool("inspect.download", {}, send), Error, "missing url");
});

// --- Safety: unknown tool ---

Deno.test("[safety/what] handleInspectTool throws on unknown tool", async () => {
  const { send } = mockSend();
  await assertRejects(() => handleInspectTool("inspect.unknown", {}, send), Error, "Unknown inspect tool");
});
