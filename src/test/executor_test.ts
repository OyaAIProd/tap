/**
 * Constraint: Tap executor (safety / what)
 * Why: executor is the bridge between .tap.js files and the page proxy.
 * Wrong loading, missing format support, or bad normalization = broken taps.
 *
 * Run: deno test deno/test/executor_test.ts --allow-read --allow-write
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { listTaps, loadTap, runTap } from "../executor.ts";

// --- Safety: dynamic tap loading ---

Deno.test("[safety/what] loadTap dynamically imports .tap.js from disk", async () => {
  // Why: this is THE core capability — static imports in extension are eliminated
  const tmpDir = await Deno.makeTempDir();
  const tapPath = `${tmpDir}/test/hello.tap.js`;
  await Deno.mkdir(`${tmpDir}/test`, { recursive: true });
  await Deno.writeTextFile(
    tapPath,
    `export default {
      site: "test", name: "hello",
      description: "test tap",
      columns: ["msg"],
      async run(page, args) { return [{ msg: "hi" }] }
    }`,
  );

  const tap = await loadTap(tapPath);
  assertEquals(tap.site, "test");
  assertEquals(tap.name, "hello");
  assertExists(tap.run);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("[safety/what] loadTap rejects non-existent file", async () => {
  // Why: clear error on missing tap beats silent failure
  await assertRejects(
    () => loadTap("/nonexistent/path/foo.tap.js"),
    Error,
  );
});

// --- Safety: tap discovery ---

Deno.test("[safety/what] listTaps discovers taps from directory tree", async () => {
  // Why: CLI `tap list` and MCP tools/list depend on discovery
  const tmpDir = await Deno.makeTempDir();
  await Deno.mkdir(`${tmpDir}/weibo`, { recursive: true });
  await Deno.mkdir(`${tmpDir}/github`, { recursive: true });
  await Deno.writeTextFile(
    `${tmpDir}/weibo/hot.tap.js`,
    `export default { site:"weibo", name:"hot", description:"微博热搜",
       columns:["title"], async run(p) { return [] } }`,
  );
  await Deno.writeTextFile(
    `${tmpDir}/github/trending.tap.js`,
    `export default { site:"github", name:"trending", description:"GitHub trending",
       columns:["repo"], async run(p) { return [] } }`,
  );

  const taps = await listTaps([tmpDir]);
  assertEquals(taps.length, 2);
  const sites = taps.map((t) => t.site).sort();
  assertEquals(sites, ["github", "weibo"]);
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("[safety/what] listTaps merges multiple directories", async () => {
  // Why: bundled taps (extension/taps) + user taps (~/.tap/taps) must coexist
  const dir1 = await Deno.makeTempDir();
  const dir2 = await Deno.makeTempDir();
  await Deno.mkdir(`${dir1}/a`, { recursive: true });
  await Deno.mkdir(`${dir2}/b`, { recursive: true });
  await Deno.writeTextFile(
    `${dir1}/a/x.tap.js`,
    `export default { site:"a", name:"x", description:"", columns:[], async run() { return [] } }`,
  );
  await Deno.writeTextFile(
    `${dir2}/b/y.tap.js`,
    `export default { site:"b", name:"y", description:"", columns:[], async run() { return [] } }`,
  );

  const taps = await listTaps([dir1, dir2]);
  assertEquals(taps.length, 2);
  await Deno.remove(dir1, { recursive: true });
  await Deno.remove(dir2, { recursive: true });
});

// --- Safety: run format execution ---

Deno.test("[safety/what] runTap executes run-format tap with page proxy", async () => {
  // Why: run format is the primary execution path for interactive taps
  const tap = {
    site: "test",
    name: "run_format",
    description: "test",
    columns: ["col"],
    async run(
      _page: unknown,
      _args: Record<string, unknown>,
    ) {
      return [{ col: "value" }];
    },
  };

  const result = await runTap(tap, {}, () => Promise.resolve({}));
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0].col, "value");
  assertExists(result.timing.total_ms);
});

// --- Quality: row normalization ---

Deno.test("[quality/what] runTap normalizes all row values to strings", async () => {
  // Why: downstream consumers (CLI table, MCP) expect uniform string values
  const tap = {
    site: "test",
    name: "normalize",
    description: "test",
    columns: ["num", "bool", "nul"],
    async run() {
      return [{ num: 42, bool: true, nul: null }];
    },
  };

  const result = await runTap(tap, {}, () => Promise.resolve({}));
  assertEquals(result.rows[0].num, "42");
  assertEquals(result.rows[0].bool, "true");
  assertEquals(result.rows[0].nul, "");
});

// --- Quality: column inference ---

Deno.test("[quality/what] runTap infers columns from first row when not declared", async () => {
  // Why: extract-format taps omit columns — executor must infer from data
  const tap = {
    site: "test",
    name: "infer",
    description: "test",
    async run() {
      return [{ title: "hello", score: "99" }];
    },
  };

  const result = await runTap(tap, {}, () => Promise.resolve({}));
  assertEquals(result.columns.sort(), ["score", "title"]);
});

// --- Safety: extract format execution ---

Deno.test("[safety/what] runTap executes extract-format tap via page.nav + page.eval", async () => {
  // Why: extract format is 80%+ of taps — nav(url) → waitFor → eval(extract) → return
  const calls: Array<{ type: string; method: string; params: Record<string, unknown> }> = [];
  const send = (type: string, method: string, params: Record<string, unknown>) => {
    calls.push({ type, method, params });
    if (method === "eval") {
      return Promise.resolve([{ title: "hello", score: "99" }]);
    }
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "extract_format",
    description: "test extract",
    url: "https://example.com/trending",
    waitFor: ".item",
    extract: (args: Record<string, unknown>) => {
      return [{ title: "hello", score: "99" }];
    },
  };

  const result = await runTap(tap, {}, send);

  const navCall = calls.find(c => c.method === "nav");
  assertEquals(navCall?.params?.url, "https://example.com/trending");

  const waitCall = calls.find(c => c.method === "waitFor");
  assertEquals(waitCall?.params?.selector, ".item");

  const evalCall = calls.find(c => c.method === "eval");
  assertExists(evalCall, "must call page.eval");

  assertEquals(result.rows.length >= 1, true);
});

Deno.test("[safety/what] runTap extract with dynamic url function", async () => {
  // Why: some taps compute URL from args (e.g., search taps)
  const calls: Array<{ type: string; method: string; params: Record<string, unknown> }> = [];
  const send = (type: string, method: string, params: Record<string, unknown>) => {
    calls.push({ type, method, params });
    if (method === "eval") return Promise.resolve([{ r: "1" }]);
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "dynamic_url",
    description: "test",
    url: (args: Record<string, unknown>) => `https://example.com/search?q=${args.query}`,
    extract: () => [{ r: "1" }],
  };

  const result = await runTap(tap, { query: "rust" }, send);
  const navCall = calls.find(c => c.method === "nav");
  assertEquals(navCall?.params?.url, "https://example.com/search?q=rust");
  assertEquals(result.count >= 1, true);
});

Deno.test("[safety/what] runTap extract applies limit arg", async () => {
  // Why: runtime must honor limit to avoid returning thousands of rows
  const send = (_t: string, method: string, _p: Record<string, unknown>) => {
    if (method === "eval") {
      return Promise.resolve(Array.from({ length: 50 }, (_, i) => ({ n: String(i) })));
    }
    return Promise.resolve({});
  };

  const tap = {
    site: "test",
    name: "limit",
    description: "test",
    url: "https://example.com",
    extract: () => [],
    args: { limit: { type: "int" as const, default: 20 } },
  };

  const result = await runTap(tap, { limit: 10 }, send);
  assertEquals(result.rows.length, 10);
});

// --- Safety: tap composition must be local ---

Deno.test("[safety/what] page.tap() composes sub-taps locally without extension", async () => {
  // Why: page.tap() is THE composition primitive. If it depends on
  // extension tap registry, composition breaks when taps aren't registered.
  // Composition must be purely local: load from disk, run in executor.
  const tmpDir = await Deno.makeTempDir();
  await Deno.mkdir(`${tmpDir}/site_a`, { recursive: true });
  await Deno.mkdir(`${tmpDir}/site_b`, { recursive: true });

  // Sub-tap: returns data
  await Deno.writeTextFile(
    `${tmpDir}/site_a/data.tap.js`,
    `export default {
      site: "site_a", name: "data", description: "sub-tap",
      columns: ["val"],
      async run(page, args) { return [{ val: "from_sub_tap" }] }
    }`,
  );

  // Parent tap: composes via page.tap()
  await Deno.writeTextFile(
    `${tmpDir}/site_b/compose.tap.js`,
    `export default {
      site: "site_b", name: "compose", description: "parent",
      columns: ["result"],
      async run(page, args) {
        const data = await page.tap("site_a", "data");
        return [{ result: data[0].val }];
      }
    }`,
  );

  const calls: string[] = [];
  const send = (_t: string, method: string, _p: Record<string, unknown>) => {
    calls.push(method);
    return Promise.resolve({});
  };

  const tap = await loadTap(`${tmpDir}/site_b/compose.tap.js`);
  const result = await runTap(tap, {}, send, [tmpDir]);

  // Composition worked — got data from sub-tap
  assertEquals(result.rows[0].result, "from_sub_tap");

  // No "run" method was sent to extension — composition is local
  assertEquals(calls.includes("run"), false,
    "page.tap() must NOT send 'run' to extension — composition is local");

  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("[safety/what] page.tap() throws if tapDirs not provided", async () => {
  // Why: page.tap() without tapDirs means composition can't work.
  // Better to fail fast than silently fall through to extension.
  const tap = {
    site: "test", name: "no_dirs", description: "test",
    columns: ["x"],
    async run(page: unknown) {
      await (page as { tap: (s: string, n: string) => Promise<unknown> }).tap("foo", "bar");
      return [];
    },
  };

  await assertRejects(
    () => runTap(tap, {}, () => Promise.resolve({})),
    Error,
    "must be wired",
  );
});

// --- Safety: timing is always present ---

Deno.test("[safety/what] runTap result includes timing.total_ms", async () => {
  // Why: logging and health monitoring depend on timing data
  const tap = {
    site: "test",
    name: "timing",
    description: "test",
    columns: ["x"],
    async run() {
      return [{ x: "1" }];
    },
  };

  const result = await runTap(tap, {}, () => Promise.resolve({}));
  assertEquals(typeof result.timing.total_ms, "number");
  assertEquals(result.timing.total_ms >= 0, true);
});
