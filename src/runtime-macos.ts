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
}

// --- Helpers ---

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Run a script via osascript stdin (avoids shell injection). */
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

async function jxa(s: string): Promise<unknown> {
  const out = await run(s, "JavaScript");
  if (!out) return null;
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
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

/** Get frontmost app process name. */
async function frontmostApp(): Promise<string> {
  return as(
    `tell application "System Events" to name of first application process whose frontmost is true`,
  );
}

// --- Runtime ---

export async function createMacOSRuntime(
  options: { app?: string } = {},
): Promise<MacOSRuntime> {
  let currentApp = options.app || "";

  if (currentApp) {
    await as(`tell application "${currentApp}" to activate`);
    await delay(300);
    currentApp = await frontmostApp();
  } else {
    currentApp = await frontmostApp();
  }

  /** JXA: search AX tree for elements matching query. */
  function axFindScript(query: string, role?: string): string {
    return `
      var se = Application("System Events");
      var proc = se.processes[${JSON.stringify(currentApp)}];
      proc.frontmost = true;
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
      proc.frontmost = true;
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

      case "page.pointer": {
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
        if (action === "type" || action === "insertText") {
          // Type full text string via System Events
          const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
          await as(`tell application "System Events" to keystroke "${escaped}"`);
        } else if (action === "press") {
          const parsed = parseKey(key);
          const modStr = parsed.mods.length
            ? ` using {${parsed.mods.join(", ")}}`
            : "";
          if (parsed.code !== undefined) {
            await as(
              `tell application "System Events" to key code ${parsed.code}${modStr}`,
            );
          } else {
            await as(
              `tell application "System Events" to keystroke "${parsed.char}"${modStr}`,
            );
          }
        } else if (action === "down" || action === "up") {
          const parsed = parseKey(key);
          const code = parsed.code ?? (parsed.char?.charCodeAt(0) || 0);
          const isDown = action === "down";
          await jxa(`
            ObjC.import('CoreGraphics');
            var e = $.CGEventCreateKeyboardEvent(null, ${code}, ${isDown});
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
        // Try to capture just the frontmost window
        try {
          const wid = await jxa(`
            ObjC.import('CoreGraphics');
            var list = ObjC.deepUnwrap(
              $.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0)
            );
            var win = list.find(function(w) {
              return w.kCGWindowOwnerName === ${JSON.stringify(currentApp)} && w.kCGWindowLayer === 0;
            });
            win ? String(win.kCGWindowNumber) : "";
          `);
          if (wid) {
            const id = String(wid);
            const { success } = await new Deno.Command("screencapture", {
              args: ["-x", `-l${id}`, tmp],
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
        // Focus the field
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
      /* no persistent resources to clean up */
    },
  };
}
