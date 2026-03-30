/**
 * Constraint: Page proxy API contract (safety / what)
 * Why: page proxy is the ONLY interface between Deno executor and browser runtime.
 * If a method is missing or sends wrong RPC format, taps fail silently.
 *
 * Run: deno test deno/test/page_test.ts
 */

import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createPageProxy } from "../page.ts";

// Kernel: 8 irreducible primitives (must match extension/protocol/protocol.js)
const KERNEL_METHODS = [
  "eval", "pointer", "keyboard", "nav", "wait",
  "screenshot", "tap", "capabilities",
];

// Stdlib: 16 named operations built on kernel
const STDLIB_METHODS = [
  "click", "type", "hover", "scroll", "pressKey", "select",
  "upload", "dialog", "fetch", "find", "cookies", "download",
  "waitFor", "waitForNetwork", "ssrState", "storage",
];

const ALL_METHODS = [...KERNEL_METHODS, ...STDLIB_METHODS];

// --- Safety: API surface completeness ---

Deno.test("[safety/what] page proxy exposes all 8 kernel methods", () => {
  // Why: kernel is the irreducible primitive set — missing any one breaks the protocol
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({});
  });

  for (const method of KERNEL_METHODS) {
    assertExists(
      (page as unknown as Record<string, unknown>)[method],
      `page.${method} must exist (kernel primitive)`,
    );
    assertEquals(
      typeof (page as unknown as Record<string, unknown>)[method],
      "function",
      `page.${method} must be a function`,
    );
  }
});

Deno.test("[safety/what] page proxy exposes all 16 stdlib methods", () => {
  // Why: stdlib operations are what .tap.js scripts actually call
  const page = createPageProxy(() => Promise.resolve({}));

  for (const method of STDLIB_METHODS) {
    assertExists(
      (page as unknown as Record<string, unknown>)[method],
      `page.${method} must exist (stdlib operation)`,
    );
    assertEquals(
      typeof (page as unknown as Record<string, unknown>)[method],
      "function",
      `page.${method} must be a function`,
    );
  }
});

Deno.test("[safety/what] page proxy is flat (no nesting)", () => {
  // Why: .tap.js scripts call page.click(), not page.stdlib.click()
  // Protocol constraint from protocol.test.mjs: "flat public API"
  const page = createPageProxy(() => Promise.resolve({}));

  for (const method of ALL_METHODS) {
    assertEquals(
      typeof (page as unknown as Record<string, unknown>)[method],
      "function",
      `page.${method} must be directly on page object, not nested`,
    );
  }
});

// --- Safety: RPC message format ---

Deno.test("[safety/what] page.click sends correct RPC", async () => {
  // Why: extension dispatches by {type, method} — wrong format = silent failure
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({});
  });

  await page.click("Submit");
  assertEquals(calls[0]?.type, "tool");
  assertEquals(calls[0]?.method, "click");
  assertEquals((calls[0]?.params as Record<string, unknown>)?.target, "Submit");
});

Deno.test("[safety/what] page.eval sends expression as RPC", async () => {
  // Why: eval is the kernel escape hatch — must send expression correctly
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({ value: 42 });
  });

  await page.eval("document.title");
  assertEquals(calls[0]?.type, "cdp");
  assertEquals(calls[0]?.method, "Runtime.evaluate");
  assertEquals(
    (calls[0]?.params as Record<string, unknown>)?.expression,
    "document.title",
  );
});

Deno.test("[safety/what] page.nav sends url as RPC", async () => {
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({});
  });

  await page.nav("https://example.com");
  assertEquals(calls[0]?.type, "cdp");
  assertEquals(calls[0]?.method, "Page.navigate");
  assertEquals(
    (calls[0]?.params as Record<string, unknown>)?.url,
    "https://example.com",
  );
});

Deno.test("[safety/what] page.tap sends site+name for composition", async () => {
  // Why: page.tap() is how taps compose — must relay to extension correctly
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({ rows: [{ title: "test" }] });
  });

  await page.tap("weibo", "hot", { limit: 5 });
  assertEquals(calls[0]?.type, "tool");
  assertEquals(calls[0]?.method, "run");
  const p = calls[0]?.params as Record<string, unknown>;
  assertEquals(p?.site, "weibo");
  assertEquals(p?.name, "hot");
});

Deno.test("[safety/what] page.type sends selector+text", async () => {
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({});
  });

  await page.type("#search", "hello");
  assertEquals(calls[0]?.type, "tool");
  assertEquals(calls[0]?.method, "type");
  const p = calls[0]?.params as Record<string, unknown>;
  assertEquals(p?.selector, "#search");
  assertEquals(p?.text, "hello");
});

// --- Safety: no extra methods leak ---

Deno.test("[safety/what] page proxy has exactly 24 methods, no more", () => {
  // Why: extra methods would be unimplemented on extension side → runtime error
  const page = createPageProxy(() => Promise.resolve({}));
  const methods = Object.keys(page).filter(
    (k) => typeof (page as unknown as Record<string, unknown>)[k] === "function",
  );
  assertEquals(
    methods.length,
    24,
    `page must have exactly 24 methods (8 kernel + 16 stdlib), got ${methods.length}: ${methods.join(", ")}`,
  );
});
