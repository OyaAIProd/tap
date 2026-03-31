/**
 * Constraint: Eval auto-batching aggregates consecutive eval calls (quality / what)
 * Why: eval is ~80% of operations. N consecutive evals without deps should merge
 * into 1 evalBatch RPC, reducing round-trips by 50-80% for loop-heavy taps.
 *
 * Run: deno test src/test/eval_batching_test.ts --allow-read
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTap } from "../executor.ts";

// ============================================================================
// Tier 1: Consecutive evals without deps merge into single evalBatch
// ============================================================================

Deno.test("[quality/what] consecutive page.eval calls merge into single evalBatch RPC", async () => {
  // Why: tap code like:
  //   const x = await page.eval(...)
  //   const y = await page.eval(...)
  //   const z = await page.eval(...)
  // produces 3 RPC calls currently. With auto-batching, these should batch
  // into 1 evalBatch RPC. Expected RPC log:
  //   page.evalBatch({expressions: [expr1, expr2, expr3]})
  // NOT:
  //   page.eval({expression: expr1})
  //   page.eval({expression: expr2})
  //   page.eval({expression: expr3})

  const rpcLog: Array<{ method: string; params: Record<string, unknown> }> = [];
  const send = (_t: string, method: string, params: Record<string, unknown>) => {
    rpcLog.push({ method, params });
    if (method === "page.evalBatch") {
      // Return array of results for each expression
      const exprs = params.expressions as string[] || [];
      return Promise.resolve(exprs.map((_, i) => i + 1));
    }
    if (method === "page.eval") {
      return Promise.resolve(1);
    }
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "consecutive_evals",
    description: "test consecutive evals",
    columns: ["x", "y", "z"],
    async run(page: unknown) {
      const p = page as {
        eval: (expr: string) => Promise<number>;
      };
      // Use Promise.all() to concurrently call evals — this triggers batching
      // because all 3 evals start within the same microtask batch
      const [x, y, z] = await Promise.all([
        p.eval("1+1"),
        p.eval("2+2"),
        p.eval("3+3"),
      ]);
      return [{ x: String(x), y: String(y), z: String(z) }];
    },
  };

  const result = await runTap(tap, {}, send);

  // Must have exactly 1 evalBatch RPC, not 3 separate eval RPCs
  const evalBatches = rpcLog.filter(l => l.method === "page.evalBatch");
  const evalCalls = rpcLog.filter(l => l.method === "page.eval");

  assertEquals(
    evalBatches.length,
    1,
    "concurrent evals must merge into 1 evalBatch RPC, got " +
    `${evalBatches.length} evalBatch + ${evalCalls.length} eval calls`,
  );

  // The single evalBatch must contain all 3 expressions
  assertEquals(
    (evalBatches[0].params.expressions as string[]).length,
    3,
    "evalBatch must contain all 3 aggregated expressions",
  );

  // Results must still be correct
  assertEquals(result.rows[0].x, "1");
  assertEquals(result.rows[0].y, "2");
  assertEquals(result.rows[0].z, "3");
});

Deno.test("[quality/what] eval calls separated by non-eval ops remain separate", async () => {
  // Why: if tap code has:
  //   const x = await page.eval(...)
  //   await page.click(...)      ← blocks batching
  //   const y = await page.eval(...)
  // Then we have 2 batches: [eval(x)], [eval(y)]
  // NOT a single batch [eval(x), click, eval(y)]

  const rpcLog: Array<{ method: string; params: Record<string, unknown> }> = [];
  let batchCount = 0;
  const send = (_t: string, method: string, params: Record<string, unknown>) => {
    rpcLog.push({ method, params });
    if (method === "page.evalBatch") {
      batchCount++;
      const exprs = params.expressions as string[];
      // Return incrementing values for each batch (1 for batch#1, 2 for batch#2)
      return Promise.resolve(exprs.map(() => batchCount));
    }
    if (method === "page.eval") return Promise.resolve(1);
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "eval_click_eval",
    description: "test batching boundary",
    columns: ["x", "y"],
    async run(page: unknown) {
      const p = page as {
        eval: (expr: string) => Promise<number>;
        click: (target: string) => Promise<unknown>;
      };
      // First eval (will batch with any concurrent evals)
      const x = await p.eval("1+1");
      // Click flushes the buffer
      await p.click("button");
      // Second eval starts new batch
      const y = await p.eval("2+2");
      return [{ x: String(x), y: String(y) }];
    },
  };

  const result = await runTap(tap, {}, send);

  // RPC sequence should be:
  //   evalBatch([expr1]) for the first eval
  //   click()
  //   evalBatch([expr2]) for the second eval
  const evalBatches = rpcLog.filter(l => l.method === "page.evalBatch");
  const clickCalls = rpcLog.filter(l => l.method === "page.click");

  assertEquals(evalBatches.length, 2, "evals separated by click should produce 2 batches");
  assertEquals(clickCalls.length, 1, "must have 1 click call");

  // Verify order: evalBatch, click, evalBatch
  const evalBatchIndices = rpcLog
    .map((l, i) => (l.method === "page.evalBatch" ? i : -1))
    .filter(i => i >= 0);
  const clickIndex = rpcLog.findIndex(l => l.method === "page.click");

  assertEquals(
    evalBatchIndices[0] < clickIndex && clickIndex < evalBatchIndices[1],
    true,
    "sequence must be: evalBatch, click, evalBatch",
  );

  assertEquals(result.rows[0].x, "1");
  assertEquals(result.rows[0].y, "2");
});

// ============================================================================
// Tier 2: evalBatch batching respects flush on non-eval operations
// ============================================================================

Deno.test("[quality/what] eval batching flushes on non-eval operations", async () => {
  // Why: when tap code calls eval, then non-eval op (like click), then eval again,
  // the buffer must flush between them so the click happens after the first eval completes.

  const rpcLog: Array<{ method: string }> = [];
  let batchCount = 0;

  const send = (_t: string, method: string, params: Record<string, unknown>) => {
    rpcLog.push({ method });
    if (method === "page.evalBatch") {
      batchCount++;
      const exprs = params.expressions as string[] || [];
      // Return different value for each batch
      return Promise.resolve(exprs.map(() => batchCount));
    }
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "batching_flush_on_non_eval",
    description: "test flush on non-eval",
    columns: ["result"],
    async run(page: unknown) {
      const p = page as {
        eval: (expr: string) => Promise<number>;
        hover: (selector: string) => Promise<unknown>;
      };
      // First eval
      const x = await p.eval("1");
      // Non-eval operation (hover) must flush the buffer
      await p.hover(".item");
      // Second eval creates new batch
      const y = await p.eval("2");
      return [{ result: `${x},${y}` }];
    },
  };

  const result = await runTap(tap, {}, send);

  // Should have 2 batches: [eval1] -> hover -> [eval2]
  const batches = rpcLog.filter(l => l.method === "page.evalBatch");
  const hovers = rpcLog.filter(l => l.method === "page.hover");

  assertEquals(batches.length, 2, "eval separated by hover should produce 2 batches");
  assertEquals(hovers.length, 1, "must have 1 hover call");

  assertEquals(result.rows[0].result, "1,2");
});

// ============================================================================
// Tier 3: Single eval still works (no regress)
// ============================================================================

Deno.test("[quality/what] single eval call still works correctly", async () => {
  // Why: batching optimization must not break single eval calls
  const rpcLog: Array<{ method: string }> = [];
  const send = (_t: string, method: string, _p: Record<string, unknown>) => {
    rpcLog.push({ method });
    if (method === "page.evalBatch") {
      return Promise.resolve([42]);
    }
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "single_eval",
    description: "test single eval",
    columns: ["x"],
    async run(page: unknown) {
      const p = page as { eval: (expr: string) => Promise<number> };
      const x = await p.eval("42");
      return [{ x: String(x) }];
    },
  };

  const result = await runTap(tap, {}, send);

  // Single eval still goes through evalBatch (batching is transparent)
  const batches = rpcLog.filter(l => l.method === "page.evalBatch");
  assertExists(batches.length > 0, "even single eval should batch");

  assertEquals(result.rows[0].x, "42");
});
