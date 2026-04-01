/**
 * Constraint: History filesystem for Meta-Forge
 * Classification: safety/what — traces must persist, versions must increment
 *
 * Run: deno test --no-check --allow-all src/test/history_test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { saveTrace, archiveVersion, updateScore, updateBest, readHistory } from "../history.ts";

// Use temp dir for isolation
const tmpDir = await Deno.makeTempDir({ prefix: "tap-history-test-" });
Deno.env.set("TAP_HOME", tmpDir);

Deno.test("[safety/what] saveTrace writes trace JSON to latest/", async () => {
  const file = await saveTrace("test", "hello", [
    { method: "page.nav", params_summary: '{"url":"https://test.com"}', duration_ms: 100 },
    { method: "page.eval", params_summary: '{"expression":"1+1"}', result_summary: "2", duration_ms: 50 },
  ], { query: "test" });

  const content = JSON.parse(await Deno.readTextFile(file));
  assertEquals(content.trace.length, 2);
  assertEquals(content.trace[0].method, "page.nav");
  assertEquals(content.args.query, "test");
  assertEquals(typeof content.ts, "number");
});

Deno.test("[safety/what] archiveVersion creates versioned directory with code + traces", async () => {
  // Pre-create a trace in latest/
  await saveTrace("test", "archive", [
    { method: "page.eval", params_summary: "{}", duration_ms: 10 },
  ], {});

  const version = await archiveVersion("test", "archive", 'export default { site: "test", name: "archive" }');
  assertEquals(version, "v001");

  // Check version directory
  const code = await Deno.readTextFile(`${tmpDir}/history/test/archive/v001/tap.js`);
  assertEquals(code.includes("test"), true);

  // Check traces were copied
  let traceCount = 0;
  for await (const e of Deno.readDir(`${tmpDir}/history/test/archive/v001/traces`)) {
    if (e.isFile) traceCount++;
  }
  assertEquals(traceCount > 0, true, "traces must be copied to version directory");
});

Deno.test("[safety/what] archiveVersion increments version number", async () => {
  const v2 = await archiveVersion("test", "archive", 'export default { version: 2 }');
  assertEquals(v2, "v002");

  const v3 = await archiveVersion("test", "archive", 'export default { version: 3 }');
  assertEquals(v3, "v003");
});

Deno.test("[quality/what] updateBest points to highest-scoring version", async () => {
  await updateScore("test", "archive", "v001", { success_rate: 0.5 });
  await updateScore("test", "archive", "v002", { success_rate: 0.9 });
  await updateScore("test", "archive", "v003", { success_rate: 0.7 });

  await updateBest("test", "archive");

  const link = await Deno.readLink(`${tmpDir}/history/test/archive/best`);
  assertEquals(link, "v002", "best must point to highest success_rate");
});

Deno.test("[quality/what] readHistory returns all versions with scores", async () => {
  const history = await readHistory("test", "archive");
  assertEquals(history.length, 3);
  assertEquals(history[0].version, "v001");
  assertEquals(history[1].version, "v002");
  assertEquals((history[1].score as any)?.success_rate, 0.9);
  assertEquals(history[0].hasCode, true);
});

// Cleanup
Deno.test("cleanup temp dir", async () => {
  await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
  Deno.env.delete("TAP_HOME");
});
