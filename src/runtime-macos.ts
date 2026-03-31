/**
 * macOS Runtime — native Mac application automation via Accessibility API.
 *
 * Implements the same RpcSend interface as browser runtimes, but operates
 * native Mac apps instead of web pages. Uses osascript (JXA/AppleScript)
 * for AX tree access and CGEvent for input. Third runtime after Chrome
 * Extension and Playwright.
 *
 * Wire method names use dot notation matching MCP tool names exactly:
 *   page.eval, page.click, page.nav, etc.
 * One name everywhere — no conversion.
 *
 * Kernel mapping:
 *   eval       → JXA (JavaScript for Automation) via osascript
 *   pointer    → CGEvent mouse events
 *   keyboard   → System Events keystroke / key code
 *   nav        → open app / URL / file
 *   wait       → delay
 *   screenshot → screencapture CLI
 *   tap        → composition (wired by executor)
 *   capabilities → runtime metadata
 *
 * Usage: tap --runtime macos <site> <name> [--app "App Name"]
 */

import type { RpcSend } from "./page.ts";

export interface MacOSRuntime {
  send: RpcSend;
  close: () => Promise<void>;
  app: string;
  /** Returns "x,y,w,h" of the app's frontmost window, or "" if not found. */
  getWindowRect: () => Promise<string>;
}

// --- Helpers ---

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Run a one-shot script via osascript (used for AppleScript only). */
async function run(
  script: string,
  lang: "AppleScript" | "JavaScript",
): Promise<string> {
  const args = lang === "JavaScript" ? ["-l", "JavaScript"] : [];
  const cmd = new Deno.Command("osascript", {
    args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const w = child.stdin.getWriter();
  await w.write(enc.encode(script));
  await w.close();
  const { stdout, stderr, success } = await child.output();
  if (!success) throw new Error(dec.decode(stderr));
  return dec.decode(stdout).trim();
}

const as = (s: string) => run(s, "AppleScript");

/**
 * Persistent JXA process — one osascript for the entire runtime lifetime.
 * Eliminates focus-switching between operations (the #1 macOS tap stability issue).
 *
 * Protocol: newline-delimited JSON over stdin/stdout.
 *   → {"id":1,"s":"Application('WeChat').activate()"}
 *   ← {"id":1,"r":"WeChat"}           // success
 *   ← {"id":1,"e":"Error: ..."}       // error
 */
class JxaProcess {
  private child: Deno.ChildProcess;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private buf = "";
  private readyResolve!: () => void;

  constructor() {
    // Bootstrap: JXA REPL that reads JSON messages from stdin, eval()s, writes results to stdout.
    // Must be a file because osascript reads ALL of stdin as script before executing.
    // With a file arg, osascript runs the file and stdin is free for the message protocol.
    const bootstrap = `
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
var __app = Application.currentApplication();
__app.includeStandardAdditions = true;
var __stdin = $.NSFileHandle.fileHandleWithStandardInput;
var __stdout = $.NSFileHandle.fileHandleWithStandardOutput;
function __write(s) {
  __stdout.writeData($.NSString.alloc.initWithUTF8String(s + "\\n").dataUsingEncoding($.NSUTF8StringEncoding));
}
__write(JSON.stringify({id:0,r:"ready"}));
var __buf = "";
while (true) {
  var __data = __stdin.availableData;
  if (__data.length === 0) break;
  __buf += $.NSString.alloc.initWithDataEncoding(__data, $.NSUTF8StringEncoding).js;
  var __lines = __buf.split("\\n");
  __buf = __lines.pop();
  for (var __i = 0; __i < __lines.length; __i++) {
    if (!__lines[__i].trim()) continue;
    var __msg = JSON.parse(__lines[__i]);
    try {
      var __result = eval(__msg.s);
      __write(JSON.stringify({id: __msg.id, r: __result}));
    } catch(__err) {
      __write(JSON.stringify({id: __msg.id, e: String(__err)}));
    }
  }
}
`;
    // Write bootstrap to temp file
    const tmp = Deno.makeTempFileSync({ suffix: ".js" });
    Deno.writeTextFileSync(tmp, bootstrap);

    // Run osascript with file arg — stdin is free for messages
    const cmd = new Deno.Command("osascript", {
      args: ["-l", "JavaScript", tmp],
      stdin: "piped",
      stdout: "piped",
      stderr: "null",
    });
    this.child = cmd.spawn();
    this.writer = this.child.stdin.getWriter();

    // Bootstrap sends {id:0, r:"ready"} when REPL loop starts
    this.ready = new Promise((resolve) => {
      this.readyResolve = resolve;
      this.pending.set(0, { resolve: () => resolve(), reject: () => resolve() });
    });

    // Read stdout line-by-line, dispatch to pending
    this.readLoop();

    // Clean up temp file after process starts
    delay(500).then(() => Deno.remove(tmp).catch(() => {}));
  }

  private async readLoop() {
    const reader = this.child.stdout.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buf += dec.decode(value);
        const lines = this.buf.split("\n");
        this.buf = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);
            const p = this.pending.get(msg.id);
            if (p) {
              this.pending.delete(msg.id);
              if (msg.e) p.reject(new Error(msg.e));
              else p.resolve(msg.r ?? null);
            }
          } catch { /* skip malformed lines */ }
        }
      }
    } catch { /* process exited */ }
    // Reject all remaining pending
    for (const [, p] of this.pending) p.reject(new Error("JXA process exited"));
    this.pending.clear();
  }

  private ready: Promise<void>;

  /** Wait for the bootstrap "ready" signal before sending evals. */
  waitReady(): Promise<void> { return this.ready; }

  eval(script: string, timeoutMs = 30000): Promise<unknown> {
    const id = this.nextId++;
    const line = JSON.stringify({ id, s: script }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JXA eval timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      this.writer.write(enc.encode(line)).catch(reject);
    });
  }

  close() {
    try { this.writer.close().catch(() => {}); } catch { /* already closed */ }
    try { this.child.kill("SIGKILL"); } catch { /* already dead */ }
  }
}

// Module-level singleton: lazily created, reused across runtime instances
let _jxaProc: JxaProcess | null = null;

// Ensure osascript is killed when Deno exits (prevents zombie processes eating 100% CPU)
globalThis.addEventListener("unload", () => {
  if (_jxaProc) { _jxaProc.close(); _jxaProc = null; }
});
// Also handle SIGINT/SIGTERM
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  try {
    Deno.addSignalListener(sig, () => {
      if (_jxaProc) { _jxaProc.close(); _jxaProc = null; }
      Deno.exit(0);
    });
  } catch { /* ignore if signal not supported */ }
}

async function getJxa(): Promise<JxaProcess> {
  if (!_jxaProc) {
    _jxaProc = new JxaProcess();
    await _jxaProc.waitReady();
  }
  return _jxaProc;
}

/** Execute JXA in the persistent process (single process, no focus switching). */
async function jxa(s: string): Promise<unknown> {
  const proc = await getJxa();
  const result = await proc.eval(s);
  // Match old jxa() behavior: if result is a JSON string, parse it
  if (typeof result === "string") {
    try { return JSON.parse(result); } catch { return result; }
  }
  return result ?? null;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Encode Uint8Array to base64 in chunks (safe for large screenshots). */
function toBase64(data: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < data.length; i += 8192) {
    bin += String.fromCharCode(...data.subarray(i, Math.min(i + 8192, data.length)));
  }
  return btoa(bin);
}

/** macOS key code map (web key name → virtual key code). */
const KEY_CODES: Record<string, number> = {
  Enter: 36, Return: 36, Tab: 48, Escape: 53, Space: 49,
  Backspace: 51, Delete: 117, ForwardDelete: 117,
  ArrowUp: 126, ArrowDown: 125, ArrowLeft: 123, ArrowRight: 124,
  Home: 115, End: 119, PageUp: 116, PageDown: 121,
  F1: 122, F2: 120, F3: 99, F4: 118, F5: 96, F6: 97,
  F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
};

/** Character → macOS virtual key code (for CGEvent physical keyboard simulation). */
const CHAR_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17, o: 31, u: 32,
  i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
  "1": 18, "2": 19, "3": 20, "4": 21, "5": 23, "6": 22,
  "7": 26, "8": 28, "9": 25, "0": 29,
  "-": 27, "=": 24, "[": 33, "]": 30, ";": 41, "'": 39,
  "\\": 42, ",": 43, ".": 47, "/": 44, "`": 50,
};

/** CGEvent modifier flag constants. */
const CG_MOD_FLAGS: Record<string, number> = {
  "command down": 0x100000,  // kCGEventFlagMaskCommand
  "shift down":   0x020000,  // kCGEventFlagMaskShift
  "control down": 0x040000,  // kCGEventFlagMaskControl
  "option down":  0x080000,  // kCGEventFlagMaskAlternate
};

/** Parse key combo like "Meta+A" into key + modifiers. */
function parseKey(key: string): {
  char?: string;
  code?: number;
  mods: string[];
} {
  const parts = key.split("+");
  const mods: string[] = [];
  const main = parts.pop()!;
  for (const mod of parts) {
    const m = mod.toLowerCase();
    if (m === "meta" || m === "command" || m === "cmd") {
      mods.push("command down");
    } else if (m === "control" || m === "ctrl") mods.push("control down");
    else if (m === "alt" || m === "option") mods.push("option down");
    else if (m === "shift") mods.push("shift down");
  }
  const code = KEY_CODES[main];
  if (code !== undefined) return { code, mods };
  return { char: main, mods };
}

/** Resolve a parsed key to its virtual key code (special keys + characters). */
function resolveKeyCode(parsed: { char?: string; code?: number }): number | undefined {
  if (parsed.code !== undefined) return parsed.code;
  if (parsed.char) return CHAR_CODES[parsed.char.toLowerCase()];
  return undefined;
}

/** Get frontmost app process name. */
async function frontmostApp(): Promise<string> {
  return as(
    `tell application "System Events" to name of first application process whose frontmost is true`,
  );
}

// --- Runtime ---

export async function createMacOSRuntime(
  options: { app?: string; background?: boolean } = {},
): Promise<MacOSRuntime> {
  const background = options.background || false;
  let currentApp = options.app || "";

  if (currentApp) {
    if (background) {
      // Launch without stealing focus
      await as(`tell application "${currentApp}" to launch`);
      await delay(300);
    } else {
      await as(`tell application "${currentApp}" to activate`);
      await delay(300);
      currentApp = await frontmostApp();
    }
  } else {
    if (background) throw new Error("--background requires --app");
    currentApp = await frontmostApp();
  }

  /** JXA: search AX tree for elements matching query. */
  function axFindScript(query: string, role?: string): string {
    return `
      var se = Application("System Events");
      var proc = se.processes[${JSON.stringify(currentApp)}];
      ${background ? "" : "proc.frontmost = true;"}
      function search(el, q, role, results, depth) {
        if (depth > 8 || results.length >= 20) return;
        try {
          var n = String(el.name() || "");
          var d = String(el.description() || "");
          var r = String(el.role() || "");
          var v = String(el.value() || "");
          var ql = q.toLowerCase();
          var match = n.toLowerCase().includes(ql) ||
                      d.toLowerCase().includes(ql) ||
                      v.toLowerCase().includes(ql);
          if (match && (!role || r.toLowerCase().includes(role.toLowerCase()))) {
            var pos, sz;
            try { pos = el.position(); sz = el.size(); } catch(e) { return; }
            if (!pos || !sz) return;
            results.push({
              name: n, role: r, description: d, value: v,
              box: { x: pos[0], y: pos[1], w: sz[0], h: sz[1] },
              center: { x: Math.round(pos[0] + sz[0]/2), y: Math.round(pos[1] + sz[1]/2) },
            });
          }
        } catch(e) {}
        try {
          var kids = el.uiElements();
          for (var i = 0; i < kids.length; i++) {
            search(kids[i], q, role, results, depth + 1);
          }
        } catch(e) {}
      }
      var results = [];
      try {
        var wins = proc.windows();
        for (var w = 0; w < wins.length; w++) {
          search(wins[w], ${JSON.stringify(query)}, ${JSON.stringify(role || "")}, results, 0);
        }
      } catch(e) {}
      JSON.stringify(results);
    `;
  }

  /** JXA: find element and click via AXPress, return fallback coords if needed. */
  function axClickScript(target: string): string {
    return `
      var se = Application("System Events");
      var proc = se.processes[${JSON.stringify(currentApp)}];
      ${background ? "" : "proc.frontmost = true;"}
      function findFirst(el, q, depth) {
        if (depth > 8) return null;
        try {
          var n = String(el.name() || "");
          var d = String(el.description() || "");
          var v = String(el.value() || "");
          var ql = q.toLowerCase();
          if (n.toLowerCase().includes(ql) || d.toLowerCase().includes(ql) || v.toLowerCase().includes(ql)) {
            return el;
          }
        } catch(e) {}
        try {
          var kids = el.uiElements();
          for (var i = 0; i < kids.length; i++) {
            var found = findFirst(kids[i], q, depth + 1);
            if (found) return found;
          }
        } catch(e) {}
        return null;
      }
      function main() {
        var el = null;
        var wins = proc.windows();
        for (var w = 0; w < wins.length; w++) {
          el = findFirst(wins[w], ${JSON.stringify(target)}, 0);
          if (el) break;
        }
        if (!el) return JSON.stringify({ error: "not found" });
        try {
          var actions = el.actions();
          for (var i = 0; i < actions.length; i++) {
            if (actions[i].name() === "AXPress") {
              actions[i].perform();
              return JSON.stringify({ clicked: true });
            }
          }
        } catch(e) {}
        try {
          var pos = el.position();
          var sz = el.size();
          return JSON.stringify({
            clicked: false,
            x: Math.round(pos[0] + sz[0]/2),
            y: Math.round(pos[1] + sz[1]/2),
          });
        } catch(e) {
          return JSON.stringify({ error: "no position" });
        }
      }
      main();
    `;
  }

  /** JXA: find element and set its value via AX API (background-safe). */
  function axSetValueScript(target: string, text: string): string {
    return `
      var se = Application("System Events");
      var proc = se.processes[${JSON.stringify(currentApp)}];
      function findFirst(el, q, depth) {
        if (depth > 8) return null;
        try {
          var n = String(el.name() || "");
          var d = String(el.description() || "");
          var v = String(el.value() || "");
          var ql = q.toLowerCase();
          if (n.toLowerCase().includes(ql) || d.toLowerCase().includes(ql) || v.toLowerCase().includes(ql)) {
            return el;
          }
        } catch(e) {}
        try {
          var kids = el.uiElements();
          for (var i = 0; i < kids.length; i++) {
            var found = findFirst(kids[i], q, depth + 1);
            if (found) return found;
          }
        } catch(e) {}
        return null;
      }
      var el = null;
      var wins = proc.windows();
      for (var w = 0; w < wins.length; w++) {
        el = findFirst(wins[w], ${JSON.stringify(target)}, 0);
        if (el) break;
      }
      if (!el) JSON.stringify({ error: "not found" });
      else {
        try {
          el.value = ${JSON.stringify(text)};
          JSON.stringify({ ok: true });
        } catch(e) {
          JSON.stringify({ error: String(e) });
        }
      }
    `;
  }

  // --- RpcSend: maps abstract method names to macOS calls ---
  const send: RpcSend = async (_type, method, params) => {
    const p = params as Record<string, unknown>;

    switch (method) {
      // ================================================================
      // KERNEL — 8 primitives
      // ================================================================

      case "page.eval": {
        const expr = p.expression as string;
        try {
          return await jxa(expr);
        } catch {
          return undefined;
        }
      }

      case "page.evalBatch": {
        const expressions = (p.expressions as string[]) || [];
        const results: unknown[] = [];
        for (const expr of expressions) {
          try {
            results.push(await jxa(expr));
          } catch {
            results.push(undefined);
          }
        }
        return results;
      }

      case "page.pointer": {
        if (background) throw new Error("pointer not available in background mode — use page.click (AXPress)");
        const x = (p.x as number) || 0;
        const y = (p.y as number) || 0;
        const action = (p.action as string) || "click";
        const cg = (type: string) =>
          jxa(`
            ObjC.import('CoreGraphics');
            var e = $.CGEventCreateMouseEvent(null, $.${type}, $.CGPointMake(${x}, ${y}), 0);
            $.CGEventPost($.kCGHIDEventTap, e);
          `);
        switch (action) {
          case "click":
            await cg("kCGEventLeftMouseDown");
            await delay(50);
            await cg("kCGEventLeftMouseUp");
            break;
          case "move":
            await cg("kCGEventMouseMoved");
            break;
          case "down":
            await cg("kCGEventLeftMouseDown");
            break;
          case "up":
            await cg("kCGEventLeftMouseUp");
            break;
        }
        return {};
      }

      case "page.keyboard": {
        const key = (p.key as string) || "";
        const action = (p.action as string) || "press";

        // Background: targeted process events via System Events (no CGEvent)
        if (background) {
          const appEsc = currentApp.replace(/"/g, '\\"');
          if (action === "type" || action === "insertText") {
            if (/[^\x00-\x7F]/.test(key)) {
              // CJK: AXSetValue on focused element (keystroke can't handle)
              await jxa(`
                var se = Application("System Events");
                var proc = se.processes[${JSON.stringify(currentApp)}];
                var focused = proc.focusedUIElement();
                var cur = "";
                try { cur = String(focused.value() || ""); } catch(e) {}
                focused.value = cur + ${JSON.stringify(key)};
              `);
            } else {
              const keyEsc = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
              await as(`tell application "System Events" to tell process "${appEsc}" to keystroke "${keyEsc}"`);
            }
          } else if (action === "press") {
            const parsed = parseKey(key);
            const vkCode = resolveKeyCode(parsed);
            const modStr = parsed.mods.length ? ` using {${parsed.mods.join(", ")}}` : "";
            if (vkCode !== undefined) {
              await as(`tell application "System Events" to tell process "${appEsc}" to key code ${vkCode}${modStr}`);
            } else if (parsed.char) {
              const charEsc = parsed.char.replace(/"/g, '\\"');
              await as(`tell application "System Events" to tell process "${appEsc}" to keystroke "${charEsc}"${modStr}`);
            }
          }
          return {};
        }

        // Foreground: CGEvent (HID-level physical keyboard simulation)
        if (action === "type" || action === "insertText") {
          // Type full text string — clipboard paste for reliable CJK support
          const hasNonAscii = /[^\x00-\x7F]/.test(key);
          if (hasNonAscii) {
            // CJK: clipboard paste in one JXA call (avoids focus switch between calls)
            await jxa(`
              ObjC.import('CoreGraphics');
              var app = Application.currentApplication();
              app.includeStandardAdditions = true;
              Application(${JSON.stringify(currentApp)}).activate();
              app.setTheClipboardTo(${JSON.stringify(key)});
              delay(0.05);
              var d = $.CGEventCreateKeyboardEvent(null, 9, true);
              $.CGEventSetFlags(d, $.kCGEventFlagMaskCommand);
              $.CGEventPost($.kCGHIDEventTap, d);
              delay(0.03);
              var u = $.CGEventCreateKeyboardEvent(null, 9, false);
              $.CGEventSetFlags(u, $.kCGEventFlagMaskCommand);
              $.CGEventPost($.kCGHIDEventTap, u);
            `);
          } else {
            // ASCII: direct keystroke
            const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            await as(`tell application "System Events" to keystroke "${escaped}"`);
          }
        } else if (action === "press") {
          // Use CGEvent (HID-level, equivalent to physical keyboard).
          // AppleScript keystroke uses Accessibility Events which WebViews may ignore.
          const parsed = parseKey(key);
          const vkCode = resolveKeyCode(parsed);
          if (vkCode !== undefined) {
            // CGEvent path: physical keyboard simulation
            const flags = parsed.mods.reduce((f, m) => f | (CG_MOD_FLAGS[m] || 0), 0);
            await jxa(`
              ObjC.import('CoreGraphics');
              var d = $.CGEventCreateKeyboardEvent(null, ${vkCode}, true);
              ${flags ? `$.CGEventSetFlags(d, ${flags});` : ""}
              $.CGEventPost($.kCGHIDEventTap, d);
              delay(0.03);
              var u = $.CGEventCreateKeyboardEvent(null, ${vkCode}, false);
              ${flags ? `$.CGEventSetFlags(u, ${flags});` : ""}
              $.CGEventPost($.kCGHIDEventTap, u);
            `);
          } else {
            // Fallback to AppleScript for unmapped keys
            const modStr = parsed.mods.length
              ? ` using {${parsed.mods.join(", ")}}`
              : "";
            await as(
              `tell application "System Events" to keystroke "${parsed.char}"${modStr}`,
            );
          }
        } else if (action === "down" || action === "up") {
          const parsed = parseKey(key);
          const code = resolveKeyCode(parsed) ?? (parsed.char?.charCodeAt(0) || 0);
          const isDown = action === "down";
          const flags = parsed.mods.reduce((f, m) => f | (CG_MOD_FLAGS[m] || 0), 0);
          await jxa(`
            ObjC.import('CoreGraphics');
            var e = $.CGEventCreateKeyboardEvent(null, ${code}, ${isDown});
            ${flags ? `$.CGEventSetFlags(e, ${flags});` : ""}
            $.CGEventPost($.kCGHIDEventTap, e);
          `);
        }
        return {};
      }

      case "page.nav": {
        const url = p.url as string;
        if (/^https?:\/\/|^file:\/\//.test(url)) {
          await new Deno.Command("open", { args: [url] }).output();
        } else {
          // Treat as app name — activate it
          currentApp = url;
          await as(`tell application "${url}" to activate`);
          await delay(300);
          currentApp = await frontmostApp();
        }
        return {};
      }

      case "page.wait": {
        await delay((p.ms as number) || 1000);
        return {};
      }

      case "page.screenshot": {
        const tmp = `/tmp/tap-macos-${Date.now()}.png`;
        let captured = false;
        // Try to capture just the app's frontmost window via Accessibility API bounds
        try {
          const rect = await as(`
            tell application "System Events"
              tell process "${currentApp.replace(/"/g, '\\"')}"
                set frontWin to front window
                set pos to position of frontWin
                set sz to size of frontWin
                return (item 1 of pos as text) & "," & (item 2 of pos as text) & "," & (item 1 of sz as text) & "," & (item 2 of sz as text)
              end tell
            end tell
          `).catch(() => "");
          if (rect.trim()) {
            const { success } = await new Deno.Command("screencapture", {
              args: ["-x", "-R", rect.trim(), tmp],
            }).output();
            captured = success &&
              await Deno.stat(tmp).then(() => true).catch(() => false);
          }
        } catch { /* fall through to full-screen */ }
        if (!captured) {
          await new Deno.Command("screencapture", {
            args: ["-x", tmp],
          }).output();
        }
        const data = await Deno.readFile(tmp);
        await Deno.remove(tmp).catch(() => {});
        return { data: toBase64(data) };
      }

      case "page.copyAll": {
        // Edit menu Select All + Copy — works on WebViews where CGEvent keyboard doesn't.
        // Re-activates target app first (focus may have shifted during wait periods).
        // Saves and restores user's clipboard (text only).
        return await jxa(`
          Application(${JSON.stringify(currentApp || "System Events")}).activate();
          delay(0.3);
          var se = Application("System Events");
          var front = se.applicationProcesses.whose({frontmost: true})[0];
          var proc = front;
          // Save user clipboard
          var saved = "";
          try { saved = String(__app.theClipboard()); } catch(e) {}
          __app.setTheClipboardTo("");
          delay(0.1);
          proc.menuBars[0].menuBarItems["Edit"].menus[0].menuItems["Select All"].click();
          delay(0.5);
          proc.menuBars[0].menuBarItems["Edit"].menus[0].menuItems["Copy"].click();
          delay(0.5);
          var result = String(__app.theClipboard());
          // Restore user clipboard
          try { __app.setTheClipboardTo(saved); } catch(e) {}
          result;
        `);
      }

      case "tap.run":
        throw new Error("tap composition must be wired by executor");

      case "page.capabilities":
        return {
          protocol: "1.0.0",
          runtime: "macos",
          kernel: [
            "eval", "pointer", "keyboard", "nav",
            "wait", "screenshot", "tap", "capabilities",
          ],
          stdlib: [
            "click", "type", "hover", "scroll", "pressKey", "select",
            "find", "fetch", "download", "waitFor", "dialog", "storage",
          ],
          platform: "macos",
          currentApp,
        };

      // ================================================================
      // STDLIB — 16 operations adapted for macOS native apps
      // ================================================================

      case "page.click": {
        const target = (p.target || p.selector) as string;
        // deno-lint-ignore no-explicit-any
        const result = (await jxa(axClickScript(target))) as any;
        if (result?.error) {
          throw new Error(`click: element "${target}" ${result.error}`);
        }
        if (result && !result.clicked && result.x !== undefined) {
          if (background) throw new Error(`click: AXPress unavailable for "${target}" in background mode`);
          // AXPress unavailable — fall back to pointer click at center
          await send(_type, "page.pointer", {
            x: result.x,
            y: result.y,
            action: "click",
          });
        }
        return {};
      }

      case "page.type": {
        const selector = p.selector as string;
        const text = p.text as string;
        if (background) {
          // Background: find element via AX, set value directly (no focus/keyboard needed)
          // deno-lint-ignore no-explicit-any
          const result = (await jxa(axSetValueScript(selector, text))) as any;
          if (result?.error) throw new Error(`type: "${selector}" ${result.error}`);
          return {};
        }
        // Foreground: Focus the field
        await send(_type, "page.click", { target: selector });
        await delay(100);
        // Select all + replace
        await send(_type, "page.keyboard", { key: "Meta+A", action: "press" });
        await delay(50);
        await send(_type, "page.keyboard", { key: text, action: "type" });
        return {};
      }

      case "page.fill":
        return send(_type, "page.type", params);

      case "page.hover": {
        const target = (p.selector || p.target) as string;
        // deno-lint-ignore no-explicit-any
        const elements = (await jxa(axFindScript(target))) as any[];
        if (elements?.length > 0) {
          await send(_type, "page.pointer", {
            x: elements[0].center.x,
            y: elements[0].center.y,
            action: "move",
          });
        }
        return {};
      }

      case "page.scroll": {
        const dir = (p.direction as string) || "down";
        const amt = (p.amount as number) || 3;
        const delta = dir === "up" ? amt : -amt;
        await jxa(`
          ObjC.import('CoreGraphics');
          var e = $.CGEventCreateScrollWheelEvent(null, 0, 1, ${delta});
          $.CGEventPost($.kCGHIDEventTap, e);
        `);
        return {};
      }

      case "page.pressKey":
        return send(_type, "page.keyboard", { key: p.key, action: "press" });

      case "page.select": {
        // Click popup, wait, then click the value
        await send(_type, "page.click", { target: p.selector });
        await delay(200);
        await send(_type, "page.click", { target: p.value });
        return {};
      }

      case "page.upload": {
        // Handle file dialog: Cmd+Shift+G to open path bar, type path, confirm
        const files = typeof p.files === "string"
          ? p.files
          : (p.files as string[])?.[0] || "";
        const escaped = files.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        await as(`
          tell application "System Events"
            tell process "${currentApp}"
              keystroke "g" using {command down, shift down}
              delay 0.5
              keystroke "${escaped}"
              keystroke return
              delay 0.3
              keystroke return
            end tell
          end tell
        `);
        return {};
      }

      case "page.dialog": {
        // Handle macOS system dialogs — click first/second button
        const btnIdx = p.accept !== false ? 1 : 2;
        try {
          await as(`
            tell application "System Events"
              tell process "${currentApp}"
                click button ${btnIdx} of sheet 1 of front window
              end tell
            end tell
          `);
        } catch {
          // Fallback: try window button directly
          await as(`
            tell application "System Events"
              tell process "${currentApp}"
                click button ${btnIdx} of front window
              end tell
            end tell
          `);
        }
        return {};
      }

      case "page.find":
        return await jxa(axFindScript(p.query as string, p.role as string));

      case "page.fetch": {
        const url = p.url as string;
        const opts = (p.opts as RequestInit) || {};
        const res = await fetch(url, opts);
        return res.json();
      }

      case "page.download": {
        const url = p.url as string;
        const res = await fetch(url);
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("json")) return res.json();
        return res.text();
      }

      case "page.waitFor": {
        const target = p.selector as string;
        const timeout = (p.ms as number) || 10000;
        const start = Date.now();
        while (Date.now() - start < timeout) {
          // deno-lint-ignore no-explicit-any
          const els = (await jxa(axFindScript(target))) as any[];
          if (els?.length > 0) return {};
          await delay(500);
        }
        throw new Error(
          `waitFor timeout: "${target}" not found after ${timeout}ms`,
        );
      }

      case "page.waitForNetwork":
        return {}; // Not applicable for native apps

      case "page.cookies":
        return {}; // Not applicable for native apps

      case "page.ssrState":
        return null; // Not applicable for native apps

      case "page.storage": {
        // Read UserDefaults for the current app
        try {
          return await jxa(`
            ObjC.import('Foundation');
            var bundleId = Application(${JSON.stringify(currentApp)}).id();
            var defaults = $.NSUserDefaults.alloc.initWithSuiteName(bundleId);
            var dict = defaults.dictionaryRepresentation;
            JSON.stringify(ObjC.deepUnwrap(dict));
          `);
        } catch {
          return {};
        }
      }

      // --- Window management (maps to tab.* wire names) ---

      case "tab.list": {
        return await jxa(`
          var se = Application("System Events");
          var proc = se.processes[${JSON.stringify(currentApp)}];
          var wins = proc.windows();
          var list = [];
          for (var i = 0; i < wins.length; i++) {
            list.push({ tabId: i, title: String(wins[i].name() || ""), url: "" });
          }
          JSON.stringify(list);
        `);
      }

      case "tab.new": {
        await send(_type, "page.keyboard", {
          key: "Meta+N",
          action: "press",
        });
        await delay(300);
        return { tabId: -1, url: "" };
      }

      default:
        throw new Error(`macOS runtime: unsupported method "${method}"`);
    }
  };

  return {
    send,
    close: async () => {
      if (_jxaProc) { await _jxaProc.close(); _jxaProc = null; }
    },
    app: currentApp,
    getWindowRect: async () => {
      // Uses Accessibility API (no Screen Recording permission needed)
      const rect = await as(`
        tell application "System Events"
          tell process "${currentApp.replace(/"/g, '\\"')}"
            set frontWin to front window
            set pos to position of frontWin
            set sz to size of frontWin
            return (item 1 of pos as text) & "," & (item 2 of pos as text) & "," & (item 1 of sz as text) & "," & (item 2 of sz as text)
          end tell
        end tell
      `).catch(() => "");
      return rect.trim();
    },
  };
}
