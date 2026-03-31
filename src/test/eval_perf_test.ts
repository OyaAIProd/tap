/**
 * Constraint: eval performance optimizations (quality / perf)
 * Why: eval is the most-called kernel primitive (~80% of operations).
 * These tests verify optimization structures are in place — if any regresses,
 * the optimization was accidentally reverted.
 *
 * Run: deno test src/test/eval_perf_test.ts --allow-read
 */

import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const EXT_DIR = new URL("../../extension", import.meta.url).pathname;

async function readFile(path: string): Promise<string> {
  return await Deno.readTextFile(path);
}

// ============================================================================
// Tier 1A: waitFor must use MutationObserver, not polling
// ============================================================================

Deno.test("[quality/perf] waitFor uses MutationObserver, not polling", async () => {
  // Why: polling does N RPC round-trips (every 300ms). MutationObserver does 1.
  // Regression: someone reverts to the simpler while-loop pattern.
  const protocol = await readFile(`${EXT_DIR}/protocol/protocol.js`);

  // Extract waitFor function body
  const waitForMatch = protocol.match(/async waitFor\(selector[\s\S]*?\n    },/);
  assert(waitForMatch, "waitFor function not found in protocol.js");
  const body = waitForMatch[0];

  // Must have MutationObserver
  assert(
    body.includes("MutationObserver"),
    "waitFor must use MutationObserver for event-driven waiting (not polling)",
  );

  // Must NOT have polling pattern (while + wait/setTimeout loop)
  const hasPollingLoop = /while\s*\(/.test(body) && /kernel\.wait\(/.test(body);
  assertEquals(
    hasPollingLoop,
    false,
    "waitFor must not use polling loop (while + kernel.wait) — use MutationObserver instead",
  );
});

// ============================================================================
// Tier 2: evalBatch must exist in both runtimes
// ============================================================================

Deno.test("[quality/perf] evalBatch handler exists in extension", async () => {
  // Why: evalBatch sends N expressions in 1 RPC. Without the handler, it 404s.
  const bg = await readFile(`${EXT_DIR}/background.js`);
  assert(
    bg.includes("case 'page.evalBatch':"),
    "background.js must handle page.evalBatch wire method",
  );
});

Deno.test("[quality/perf] evalBatch handler exists in Playwright runtime", async () => {
  const pw = await Deno.readTextFile(
    new URL("../runtime-playwright.ts", import.meta.url).pathname,
  );
  assert(
    pw.includes('"page.evalBatch"'),
    "runtime-playwright.ts must handle page.evalBatch wire method",
  );
});

Deno.test("[quality/perf] evalBatch on page proxy sends correct RPC", async () => {
  // Why: evalBatch must send expressions array as single RPC, not N separate calls.
  const { createPageProxy } = await import("../page.ts");
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const send = (_t: string, method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return Promise.resolve([]);
  };
  const page = createPageProxy(send);
  await page.evalBatch(["1+1", "2+2", "3+3"]);

  assertEquals(calls.length, 1, "evalBatch must send exactly 1 RPC, not N");
  assertEquals(calls[0].method, "page.evalBatch");
  assertEquals(
    (calls[0].params.expressions as string[]).length,
    3,
    "all expressions must be in single RPC payload",
  );
});

// ============================================================================
// Tier 3: page.eval must have CDP fast path when debugger is attached
// ============================================================================

Deno.test("[quality/perf] page.eval has CDP fast path for attached debugger", async () => {
  // Why: when debugger is already attached (e.g. after pointer/keyboard), using
  // CDP Runtime.evaluate directly is single-layer eval. Without this, every eval
  // goes through chrome.scripting → (0,eval)() double-layer overhead.
  // Regression: someone removes the debuggerSessions check.
  const bg = await readFile(`${EXT_DIR}/background.js`);

  // Find the page.eval case block
  const evalCase = bg.match(/case 'page\.eval':\s*\{[\s\S]*?\n    \}/);
  assert(evalCase, "page.eval case not found in background.js");
  const body = evalCase[0];

  // Must check debuggerSessions before chrome.scripting path
  const hasDebuggerCheck = body.includes("debuggerSessions.get(tabId)");
  assert(
    hasDebuggerCheck,
    "page.eval must check debuggerSessions for CDP fast path",
  );

  // The debugger check must come BEFORE the chrome.scripting fallback
  const debuggerPos = body.indexOf("debuggerSessions.get(tabId)");
  const scriptingPos = body.indexOf("page.eval(async");
  assert(
    debuggerPos < scriptingPos,
    "CDP fast path must be checked BEFORE chrome.scripting fallback",
  );
});

// ============================================================================
// Structural: optimizations don't break eval correctness contract
// ============================================================================

Deno.test("[safety/perf] page.eval still wraps in block scope", async () => {
  // Why: block scope wrapping prevents const/let redeclaration errors across
  // sequential eval calls. Performance optimizations must not remove this.
  const bg = await readFile(`${EXT_DIR}/background.js`);
  const evalCase = bg.match(/case 'page\.eval':\s*\{[\s\S]*?\n    \}/);
  assert(evalCase, "page.eval case not found");
  assert(
    evalCase[0].includes("'{\\n'"),
    "page.eval must wrap expression in block scope { } to prevent redeclaration errors",
  );
});

Deno.test("[safety/perf] page.eval still falls back to CDP on CSP", async () => {
  // Why: some pages block eval() via CSP. CDP Runtime.evaluate bypasses CSP.
  // Performance optimizations must not remove the CSP fallback.
  const bg = await readFile(`${EXT_DIR}/background.js`);
  const evalCase = bg.match(/case 'page\.eval':\s*\{[\s\S]*?\n    \}/);
  assert(evalCase, "page.eval case not found");
  assert(
    evalCase[0].includes("Runtime.evaluate"),
    "page.eval must have CDP Runtime.evaluate fallback for CSP-blocked pages",
  );
});
