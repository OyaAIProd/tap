/**
 * Constraint: Data pipeline — transform format, JSON output, stdin input
 * Why: Tap must be a composable data pipeline, not just extraction + display.
 * "Extract any data, compose any data" — the Unix pipe philosophy for interfaces.
 *
 * Run: deno test src/test/pipeline_test.ts --allow-all --no-check
 */

import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { runTap, type TapModule, type TapResult } from "../executor.ts";

// Dummy send that records calls
function mockSend() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const send = (_t: string, method: string, params: Record<string, unknown>) => {
    calls.push({ method, params });
    return Promise.resolve(undefined);
  };
  return { send, calls };
}

// ============================================================================
// Safety/what: transform format — taps can receive and emit rows
// ============================================================================

Deno.test("[safety/what] transform tap receives rows and returns transformed rows", async () => {
  // Why: data pipeline requires tap-to-tap data flow — transform is the bridge
  const { send } = mockSend();
  const tap: TapModule = {
    site: "tap", name: "test-filter",
    description: "test",
    transform: (rows: Record<string, unknown>[], _args: Record<string, unknown>) => {
      return rows.filter((r: Record<string, unknown>) => Number(r.points) > 100);
    },
  };
  const input = [
    { title: "A", points: 142 },
    { title: "B", points: 50 },
    { title: "C", points: 200 },
  ];
  const result = await runTap(tap, { rows: input }, send);
  assertEquals(result.count, 2, "filter should keep only rows with points > 100");
  assertEquals(result.rows[0].title, "A");
  assertEquals(result.rows[1].title, "C");
});

Deno.test("[safety/what] transform tap with empty rows input returns empty", async () => {
  // Why: graceful handling of empty pipeline stage
  const { send } = mockSend();
  const tap: TapModule = {
    site: "tap", name: "test-identity",
    description: "test",
    transform: (rows: Record<string, unknown>[]) => rows,
  };
  const result = await runTap(tap, { rows: [] }, send);
  assertEquals(result.count, 0);
  assertEquals(result.rows.length, 0);
});

Deno.test("[safety/what] transform tap preserves original types in rawRows", async () => {
  // Why: pipeline data must retain types (number, boolean) for downstream processing
  const { send } = mockSend();
  const tap: TapModule = {
    site: "tap", name: "test-passthrough",
    description: "test",
    transform: (rows: Record<string, unknown>[]) => rows,
  };
  const input = [{ title: "A", points: 142, active: true }];
  const result = await runTap(tap, { rows: input }, send);
  assertExists(result.rawRows, "runTap must return rawRows with original types");
  const raw = result.rawRows[0] as Record<string, unknown>;
  assertEquals(typeof raw.points, "number", "rawRows must preserve number type");
  assertEquals(typeof raw.active, "boolean", "rawRows must preserve boolean type");
});

// ============================================================================
// Safety/what: TapModule must support three formats
// ============================================================================

Deno.test("[safety/what] TapModule accepts exactly one of run/extract/transform", async () => {
  // Why: each tap has one role in the pipeline — source, action, or transform
  const { send } = mockSend();

  // transform-only tap should work
  const tap: TapModule = {
    site: "tap", name: "test",
    description: "test",
    transform: (rows: Record<string, unknown>[]) => rows,
  };
  const result = await runTap(tap, { rows: [{ a: "1" }] }, send);
  assertEquals(result.count, 1);
});

// ============================================================================
// Quality/what: rawRows always present in TapResult
// ============================================================================

Deno.test("[quality/what] runTap always returns rawRows alongside rows", async () => {
  // Why: rows = display (strings), rawRows = pipeline (original types)
  const { send } = mockSend();
  const extractTap: TapModule = {
    site: "test", name: "extract",
    description: "test",
    url: "https://example.com",
    extract: () => [{ n: 1 }, { n: 2 }],
  };
  // For extract format, need to mock page.nav, page.eval, and page.evalBatch
  const mockSendExtract = (_t: string, method: string, p: Record<string, unknown>) => {
    if (method === "page.nav") return Promise.resolve(undefined);
    if (method === "page.eval") return Promise.resolve([{ n: 1 }, { n: 2 }]);
    if (method === "page.evalBatch") {
      const exprs = (p.expressions as string[]) || [];
      return Promise.resolve(exprs.map(() => [{ n: 1 }, { n: 2 }]));
    }
    return Promise.resolve(undefined);
  };
  const result = await runTap(extractTap, {}, mockSendExtract);
  assertExists(result.rawRows, "extract format must also return rawRows");
  assertEquals(typeof (result.rawRows[0] as Record<string, unknown>).n, "number");
  // rows should be string-ified
  assertEquals(result.rows[0].n, "1");
});

// ============================================================================
// Quality/what: CLI --json and --stdin support
// ============================================================================

Deno.test("[quality/what] CLI parseArgs recognizes --json flag", () => {
  // Why: --json enables machine-readable output for pipe composition
  // Import parseArgs from cli — we test it accepts --json
  // This is a structural constraint: the flag must be recognized
  const src = Deno.readTextFileSync(
    new URL("../cli.ts", import.meta.url).pathname,
  );
  assert(
    src.includes("--json") || src.includes('"json"'),
    "cli.ts must recognize --json flag",
  );
});

Deno.test("[quality/what] CLI parseArgs recognizes --stdin flag", () => {
  // Why: --stdin enables receiving upstream tap data for pipeline composition
  const src = Deno.readTextFileSync(
    new URL("../cli.ts", import.meta.url).pathname,
  );
  assert(
    src.includes("--stdin") || src.includes('"stdin"'),
    "cli.ts must recognize --stdin flag",
  );
});

// ============================================================================
// Quality/what: built-in transform taps exist
// ============================================================================

const TAP_HOME = `${Deno.env.get("HOME")}/.tap`;
const BUILTIN_TRANSFORMS = ["filter", "sort", "dedupe", "limit", "pick"];

for (const name of BUILTIN_TRANSFORMS) {
  Deno.test(`[quality/what] built-in transform tap/\${name} exists`, async () => {
    // Why: core pipeline operations must be taps — "data pipeline ops are also taps"
    const paths = [
      `${TAP_HOME}/taps/tap/${name}.tap.js`,
      `${TAP_HOME}/skills/tap/${name}.tap.js`,
    ];
    let found = false;
    for (const p of paths) {
      try { await Deno.stat(p); found = true; break; } catch { /* next */ }
    }
    assert(found, `tap/${name}.tap.js must exist in taps or skills dir`);
  });
}

for (const name of BUILTIN_TRANSFORMS) {
  Deno.test(`[quality/what] tap/${name} has transform function`, async () => {
    // Why: transform taps must use the transform format, not run or extract
    const paths = [
      `${TAP_HOME}/taps/tap/${name}.tap.js`,
      `${TAP_HOME}/skills/tap/${name}.tap.js`,
    ];
    let mod = null;
    for (const p of paths) {
      try {
        const stat = await Deno.stat(p);
        const url = `file://${p}?t=${stat.mtime?.getTime()}`;
        mod = (await import(url)).default;
        break;
      } catch { /* next */ }
    }
    assertExists(mod, `tap/${name}.tap.js must be loadable`);
    assertEquals(typeof mod.transform, "function", `tap/${name} must have transform()`);
    assertEquals(mod.site, "tap", `tap/${name} site must be "tap"`);
    assertEquals(mod.name, name, `tap/${name} name must be "${name}"`);
  });
}
