/**
 * Constraint: Architecture boundary (safety / what-x-what)
 * Why: Deno = userspace (executor, forge, MCP), Extension = kernel (primitives, CDP).
 * Crossing this boundary creates dual intelligence, the exact problem we eliminated.
 *
 * Run: deno test src/test/architecture_test.ts --allow-read
 */

import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const SRC_DIR = new URL("..", import.meta.url).pathname;
const EXT_DIR = new URL("../../extension", import.meta.url).pathname;

/** Read all .ts files in src/ (excluding test/) */
async function readDenoSources(): Promise<Array<{ file: string; content: string }>> {
  const files: Array<{ file: string; content: string }> = [];
  for await (const entry of Deno.readDir(SRC_DIR)) {
    if (entry.name.endsWith(".ts") && entry.name !== "test") {
      const content = await Deno.readTextFile(`${SRC_DIR}/${entry.name}`);
      files.push({ file: entry.name, content });
    }
  }
  return files;
}

/** Read extension JS files (background.js + protocol/) */
async function readExtensionSources(): Promise<Array<{ file: string; content: string }>> {
  const files: Array<{ file: string; content: string }> = [];

  // background.js
  try {
    const content = await Deno.readTextFile(`${EXT_DIR}/background.js`);
    files.push({ file: "background.js", content });
  } catch { /* not found */ }

  // protocol/*.js
  try {
    for await (const entry of Deno.readDir(`${EXT_DIR}/protocol`)) {
      if (entry.name.endsWith(".js")) {
        const content = await Deno.readTextFile(`${EXT_DIR}/protocol/${entry.name}`);
        files.push({ file: `protocol/${entry.name}`, content });
      }
    }
  } catch { /* not found */ }

  return files;
}

// --- Safety/what-x-what: Deno must not use Chrome extension APIs ---

Deno.test("[safety/what-x-what] Deno sources must not reference chrome.* APIs", async () => {
  // Why: Deno is userspace — browser control goes through page.* RPC, never direct chrome.*
  const sources = await readDenoSources();
  const violations: string[] = [];
  const chromeAPIs = /chrome\.(debugger|scripting|tabs|cookies|runtime|windows|storage)\b/;

  for (const { file, content } of sources) {
    for (const [i, line] of content.split("\n").entries()) {
      if (line.trimStart().startsWith("//")) continue; // skip comments
      if (chromeAPIs.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `Deno must not use chrome.* APIs (use page.* RPC instead):\n${violations.join("\n")}`,
  );
});

// --- Safety/what-x-what: Extension must not contain tap executor logic ---

Deno.test("[safety/what-x-what] Extension core must not contain tap executor functions", async () => {
  // Why: tap execution moved to Deno — extension is pure kernel
  const sources = await readExtensionSources();
  const violations: string[] = [];
  // These are executor-specific functions that should only be in Deno
  const executorPatterns = /\b(runTap|listTaps|registerTap|loadTap)\s*\(/;

  for (const { file, content } of sources) {
    // Skip executor.js itself (it exists but shouldn't be called from core routing)
    if (file === "protocol/executor.js") continue;
    for (const [i, line] of content.split("\n").entries()) {
      if (line.trimStart().startsWith("//")) continue;
      if (executorPatterns.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `Extension core must not call tap executor functions (moved to Deno):\n${violations.join("\n")}`,
  );
});

// --- Safety/what-x-what: Extension must not contain forge analysis ---

Deno.test("[safety/what-x-what] Extension core must not import forge.js", async () => {
  // Why: forge analysis moved to Deno — extension only provides kernel primitives
  const sources = await readExtensionSources();
  const violations: string[] = [];

  for (const { file, content } of sources) {
    if (file.includes("forge.js")) continue; // forge.js itself can exist (legacy)
    for (const [i, line] of content.split("\n").entries()) {
      if (/import.*forge|gatherForgeInspection/.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `Extension core must not import forge (moved to Deno):\n${violations.join("\n")}`,
  );
});

// --- Safety/what: page.* in Deno must go through RpcSend ---

Deno.test("[safety/what] Deno page proxy is the ONLY way to call browser primitives", async () => {
  // Why: if Deno code bypasses page proxy and calls bridge directly with
  // hardcoded CDP methods, the kernel abstraction is broken
  const sources = await readDenoSources();
  const violations: string[] = [];
  // Direct CDP method names that should go through page proxy, not raw sendTap
  const rawCDP = /sendTap\s*\(\s*["']cdp["']\s*,\s*["'](Runtime\.evaluate|Input\.dispatch|Page\.navigate)["']/;

  for (const { file, content } of sources) {
    if (file === "cli.ts") continue; // cli.ts relay is allowed (forge.verify, screenshot)
    for (const [i, line] of content.split("\n").entries()) {
      if (line.trimStart().startsWith("//")) continue;
      if (rawCDP.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `Use page proxy (page.eval/nav/click) instead of raw CDP:\n${violations.join("\n")}`,
  );
});

// --- Quality: architecture summary ---

Deno.test("[quality/what] Deno has exactly 7 source modules", async () => {
  // Why: detect accidental module sprawl — new modules should be deliberate
  const sources = await readDenoSources();
  const names = sources.map((s) => s.file).sort();
  assertEquals(
    names,
    ["bridge.ts", "cli.ts", "daemon.ts", "executor.ts", "forge.ts", "mcp.ts", "page.ts", "runtime-playwright.ts"],
    `Expected 7 modules, got: ${names.join(", ")}`,
  );
});
