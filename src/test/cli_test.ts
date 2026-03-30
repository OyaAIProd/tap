/**
 * Constraint: CLI tool dispatch (safety / what)
 * Why: tool name conversion and argument parsing are the glue
 * between MCP protocol and extension protocol. Wrong mapping = wrong tool called.
 *
 * Run: deno test deno/test/cli_test.ts --allow-read --allow-write --allow-env
 */

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

// Import the functions we need to test.
// cli.ts has top-level side effects (Deno.args, switch), so we test via dynamic import
// of extracted helpers. For now, replicate the logic to test it.

/** Convert MCP dot notation to extension method name. (copy from cli.ts) */
function convertToolName(name: string): string {
  const dot = name.indexOf(".");
  if (dot < 0) return name;
  const prefix = name.substring(0, dot);
  const action = name.substring(dot + 1);
  if (prefix === "page") return action;
  return `${prefix}_${action}`;
}

/** Parse CLI --key value pairs. (copy from cli.ts) */
function parseArgs(raw: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let i = 0;
  while (i < raw.length) {
    const key = raw[i].replace(/^--/, "");
    if (raw[i].startsWith("--") && i + 1 < raw.length && !raw[i + 1].startsWith("--")) {
      const val = raw[i + 1];
      const num = Number(val);
      result[key] = isNaN(num) ? val : num;
      i += 2;
    } else if (raw[i].startsWith("--")) {
      result[key] = true;
      i += 1;
    } else {
      i += 1;
    }
  }
  return result;
}

// --- Safety: tool name conversion ---

Deno.test("[safety/what] page.click → click (page prefix stripped)", () => {
  // Why: extension's handleTapCommand expects "click", not "page.click"
  assertEquals(convertToolName("page.click"), "click");
  assertEquals(convertToolName("page.type"), "type");
  assertEquals(convertToolName("page.eval"), "eval");
  assertEquals(convertToolName("page.nav"), "nav");
});

Deno.test("[safety/what] tab.list → tab_list (non-page prefix preserved with underscore)", () => {
  // Why: extension routes tab_list, intercept_on etc. with underscore convention
  assertEquals(convertToolName("tab.list"), "tab_list");
  assertEquals(convertToolName("tab.new"), "tab_new");
  assertEquals(convertToolName("intercept.on"), "intercept_on");
  assertEquals(convertToolName("intercept.off"), "intercept_off");
  assertEquals(convertToolName("inspect.dom"), "inspect_dom");
});

Deno.test("[safety/what] forge.inspect → forge_inspect", () => {
  // Why: forge tools use same underscore convention
  assertEquals(convertToolName("forge.inspect"), "forge_inspect");
  assertEquals(convertToolName("forge.verify"), "forge_verify");
  assertEquals(convertToolName("forge.save"), "forge_save");
});

// --- Quality: CLI argument parsing ---

Deno.test("[quality/what] parseArgs handles --key value pairs", () => {
  assertEquals(parseArgs(["--limit", "5"]), { limit: 5 });
  assertEquals(parseArgs(["--query", "rust"]), { query: "rust" });
});

Deno.test("[quality/what] parseArgs handles boolean flags", () => {
  assertEquals(parseArgs(["--verbose"]), { verbose: true });
});

Deno.test("[quality/what] parseArgs handles mixed args", () => {
  const result = parseArgs(["--limit", "10", "--verbose", "--query", "test"]);
  assertEquals(result, { limit: 10, verbose: true, query: "test" });
});
