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
  // Exclude: protocol/executor.js (definition), background.js (import/relay only)
  const executorPatterns = /\b(runTap|listTaps|registerTap|loadTap)\s*\(/;

  for (const { file, content } of sources) {
    // Skip executor.js (definitions) and background.js (relay only)
    if (file === "protocol/executor.js" || file === "background.js") continue;
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

// --- Safety/what: Deno must never send CDP commands directly ---

Deno.test("[safety/what] Deno sources must never bypass kernel via sendTap('cdp')", async () => {
  // Why: sendTap("cdp", ...) talks directly to Chrome DevTools Protocol,
  // bypassing the kernel abstraction. This breaks runtime portability —
  // Playwright runtime cannot handle CDP envelopes.
  // Fix: use createPageProxy(send) and call page.nav/eval/screenshot instead.
  const sources = await readDenoSources();
  const violations: string[] = [];
  const cdpBypass = /sendTap\s*\(\s*["']cdp["']/;

  for (const { file, content } of sources) {
    for (const [i, line] of content.split("\n").entries()) {
      if (line.trimStart().startsWith("//")) continue;
      if (cdpBypass.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `Deno must not use sendTap("cdp") — use page proxy instead:\n${violations.join("\n")}`,
  );
});

Deno.test("[safety/what] Deno sources must never reference CDP method names", async () => {
  // Why: CDP method names (Page.navigate, Runtime.evaluate, Page.captureScreenshot,
  // Input.dispatch*) are Chrome-specific. If they appear in Deno sources, something
  // is bypassing the kernel. All browser ops go through page.* wire names.
  const sources = await readDenoSources();
  const violations: string[] = [];
  const cdpMethods = /["'](Page\.navigate|Page\.captureScreenshot|Runtime\.evaluate|Input\.dispatch\w+)["']/;

  for (const { file, content } of sources) {
    for (const [i, line] of content.split("\n").entries()) {
      if (line.trimStart().startsWith("//")) continue;
      if (cdpMethods.test(line)) {
        violations.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    }
  }

  assertEquals(
    violations.length,
    0,
    `Deno must not reference CDP methods — use page.nav/eval/screenshot:\n${violations.join("\n")}`,
  );
});

// --- Quality: architecture summary ---

Deno.test("[quality/what] Deno has exactly 9 source modules", async () => {
  // Why: detect accidental module sprawl — new modules should be deliberate
  const sources = await readDenoSources();
  const names = sources.map((s) => s.file).sort();
  assertEquals(
    names,
    ["bridge.ts", "cli.ts", "daemon.ts", "executor.ts", "forge.ts", "inspect.ts", "mcp.ts", "page.ts", "runtime-playwright.ts"],
    `Expected 9 modules, got: ${names.join(", ")}`,
  );
});
