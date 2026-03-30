#!/usr/bin/env node
/**
 * tap-mcp — thin launcher for the Tap MCP server binary.
 *
 * Resolution order:
 *   1. Pre-installed binary from postinstall (npm/bin/tap-<platform>-<arch>)
 *   2. Global `tap` binary on PATH
 *   3. `deno run` if Deno is available
 */

const { spawn, execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Maps to Deno/Rust target triples used in release builds
const TARGET_MAP = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
};

function getTarget() {
  return TARGET_MAP[`${os.platform()}-${os.arch()}`] || null;
}

function findBinary() {
  const target = getTarget();
  if (!target) return null;

  const ext = os.platform() === "win32" ? ".exe" : "";
  const name = `tap-${target}${ext}`;
  const local = path.join(__dirname, name);
  if (fs.existsSync(local)) return local;

  return null;
}

function findOnPath(cmd) {
  try {
    const which = os.platform() === "win32" ? "where" : "which";
    return execFileSync(which, [cmd], { encoding: "utf8" }).trim().split("\n")[0];
  } catch {
    return null;
  }
}

function launch(bin, args) {
  const child = spawn(bin, args, { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
  child.on("error", (err) => {
    console.error(`tap-mcp: failed to start: ${err.message}`);
    process.exit(1);
  });
}

// --- Main ---

const extraArgs = process.argv.slice(2);

// 1. Local compiled binary
const binary = findBinary();
if (binary) {
  launch(binary, ["mcp", ...extraArgs]);
  return;
}

// 2. Global `tap` on PATH
const globalTap = findOnPath("tap");
if (globalTap) {
  launch(globalTap, ["mcp", ...extraArgs]);
  return;
}

// 3. Deno fallback — run from source
const deno = findOnPath("deno");
if (deno) {
  // Find cli.ts — look in common locations
  const candidates = [
    path.join(os.homedir(), ".tap", "src", "cli.ts"),
    path.join(__dirname, "..", "..", "src", "cli.ts"),
  ];
  const cliTs = candidates.find((p) => fs.existsSync(p));
  if (cliTs) {
    launch(deno, ["run", "--allow-all", "--no-check", cliTs, "mcp", ...extraArgs]);
    return;
  }
}

console.error(`tap-mcp: no binary found.

Install options:
  1. Download pre-built binary: https://github.com/LeonTing1010/tap/releases
  2. Build from source: deno compile --allow-all --output tap src/cli.ts
  3. Run directly: deno run --allow-all src/cli.ts mcp

Place the binary at: ${path.join(__dirname, `tap-${getTarget()}`)}`);
process.exit(1);
