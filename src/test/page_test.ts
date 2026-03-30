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
  assertEquals(calls[0]?.method, "page.click");
  assertEquals((calls[0]?.params as Record<string, unknown>)?.target, "Submit");
});

Deno.test("[safety/what] page.eval sends expression as RPC", async () => {
  // Why: eval is the kernel escape hatch — must send expression correctly
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve(42);
  });

  await page.eval("document.title");
  assertEquals(calls[0]?.type, "tool");
  assertEquals(calls[0]?.method, "page.eval");
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
  assertEquals(calls[0]?.type, "tool");
  assertEquals(calls[0]?.method, "page.nav");
  assertEquals(
    (calls[0]?.params as Record<string, unknown>)?.url,
    "https://example.com",
  );
});

Deno.test("[safety/what] page.tap throws — must be wired by executor", () => {
  // Why: page.tap() is composition — executor wires it at runtime to enable
  // recursive tap calls. The proxy's default must throw to catch misconfiguration.
  const page = createPageProxy(() => Promise.resolve({}));

  let threw = false;
  try {
    // deno-lint-ignore no-explicit-any
    (page as any).tap("weibo", "hot");
  } catch (e) {
    threw = true;
    assertEquals(String(e).includes("wired by executor"), true);
  }
  assertEquals(threw, true, "page.tap() must throw when not wired by executor");
});

Deno.test("[safety/what] page.type sends selector+text", async () => {
  const calls: Array<{ type: string; method: string; params: unknown }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method, params });
    return Promise.resolve({});
  });

  await page.type("#search", "hello");
  assertEquals(calls[0]?.type, "tool");
  assertEquals(calls[0]?.method, "page.type");
  const p = calls[0]?.params as Record<string, unknown>;
  assertEquals(p?.selector, "#search");
  assertEquals(p?.text, "hello");
});

// --- Safety: protocol abstraction boundary ---

Deno.test("[safety/what] page proxy never sends CDP method names", async () => {
  // Why: page proxy must use abstract names (nav, eval, pointer) not CDP names
  // (Page.navigate, Runtime.evaluate, Input.dispatchMouseEvent).
  // This is the protocol abstraction boundary — page.ts is runtime-independent.
  const calls: Array<{ type: string; method: string }> = [];
  const page = createPageProxy((type, method, params) => {
    calls.push({ type, method });
    return Promise.resolve({});
  });

  // Exercise all methods except tap (tap throws by design — wired by executor)
  await page.eval("1+1");
  await page.pointer(0, 0, "click");
  await page.keyboard("Enter", "press");
  await page.nav("https://example.com");
  await page.wait(1);
  await page.screenshot();
  // page.tap — skipped, throws by design
  await page.capabilities();
  await page.click("btn");
  await page.type("#in", "hi");
  await page.hover("a");
  await page.scroll("div");
  await page.pressKey("Tab");
  await page.select("sel", "v");
  await page.upload("input", "f");
  await page.dialog(true);
  await page.fetch("https://api.test");
  await page.find("text");
  await page.cookies();
  await page.download("https://f.test");
  await page.waitFor(".el");
  await page.waitForNetwork();
  await page.ssrState();
  await page.storage();

  // Constraint: no CDP method names anywhere
  const CDP_PATTERNS = /^(Page\.|Runtime\.|Input\.|DOM\.|Network\.|Fetch\.)/;
  for (const call of calls) {
    assertEquals(
      CDP_PATTERNS.test(call.method),
      false,
      `page proxy must not send CDP method "${call.method}" — use abstract name instead`,
    );
    assertEquals(
      call.type,
      "tool",
      `page proxy must use type "tool", not "${call.type}" (method: ${call.method})`,
    );
  }
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

// --- Safety: unified wire names (one name everywhere, no conversion) ---

Deno.test("[safety/what] all page proxy wire names use dot notation (page.*)", async () => {
  // Why: MCP tool name = wire method = extension case. No conversion layer.
  // If a wire name lacks "page." prefix, the extension won't find the handler.
  const calls: Array<{ method: string }> = [];
  const page = createPageProxy((type, method, _params) => {
    calls.push({ method });
    return Promise.resolve({});
  });

  // Exercise all methods except tap (throws by design)
  await page.eval("1");
  await page.pointer(0, 0, "click");
  await page.keyboard("a", "press");
  await page.nav("https://x.com");
  await page.wait(1);
  await page.screenshot();
  await page.capabilities();
  await page.click("btn");
  await page.type("#i", "t");
  await page.hover("a");
  await page.scroll("div");
  await page.pressKey("Tab");
  await page.select("s", "v");
  await page.upload("i", "f");
  await page.dialog(true);
  await page.fetch("https://a.test");
  await page.find("q");
  await page.cookies();
  await page.download("https://d.test");
  await page.waitFor(".e");
  await page.waitForNetwork();
  await page.ssrState();
  await page.storage();

  assertEquals(calls.length, 23, "must exercise all 23 callable methods");
  for (const { method } of calls) {
    assertEquals(
      method.startsWith("page."),
      true,
      `wire name "${method}" must use "page." prefix — one name everywhere, no conversion`,
    );
  }
});
