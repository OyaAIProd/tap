/**
 * Playwright Runtime — second kernel implementation for protocol validation.
 *
 * Implements the same RpcSend interface as the Chrome Extension runtime,
 * but uses Playwright instead of chrome.* APIs. Validates that the protocol
 * abstraction (8 kernel + 16 stdlib) is truly runtime-independent.
 *
 * Usage: tap --runtime playwright <site> <name>
 */

import type { RpcSend } from "./page.ts";

// deno-lint-ignore no-explicit-any
type PW = any; // Playwright types — loaded dynamically

let _pw: PW = null;

async function loadPlaywright(): Promise<PW> {
  if (_pw) return _pw;
  _pw = await import("npm:playwright");
  return _pw;
}

export interface PlaywrightRuntime {
  send: RpcSend;
  close: () => Promise<void>;
}

export async function createPlaywrightRuntime(
  options: { headless?: boolean } = {},
): Promise<PlaywrightRuntime> {
  const pw = await loadPlaywright();

  // Persistent profile at ~/.tap/playwright/ — preserves cookies, localStorage, sessions
  const profileDir = `${Deno.env.get("TAP_HOME") || `${Deno.env.get("HOME")}/.tap`}/playwright`;
  await Deno.mkdir(profileDir, { recursive: true }).catch(() => {});

  const context = await pw.chromium.launchPersistentContext(profileDir, {
    headless: options.headless ?? false,
    channel: "chrome",
  });
  let page = context.pages()[0] || await context.newPage();

  // --- RpcSend: maps abstract method names to Playwright calls ---
  const send: RpcSend = async (_type, method, params) => {
    const p = params as Record<string, unknown>;

    switch (method) {
      // ================================================================
      // KERNEL — 8 primitives
      // ================================================================

      case "eval": {
        const expr = p.expression as string;
        const args = (p.args as unknown[]) || [];
        try {
          if (args.length > 0) {
            return await page.evaluate(
              `(${expr})(${args.map((a: unknown) => JSON.stringify(a)).join(",")})`,
            );
          }
          return await page.evaluate(expr);
        } catch {
          return undefined;
        }
      }

      case "pointer": {
        const x = (p.x as number) || 0;
        const y = (p.y as number) || 0;
        const action = (p.action as string) || "click";
        switch (action) {
          case "click": await page.mouse.click(x, y); break;
          case "move": await page.mouse.move(x, y); break;
          case "down": await page.mouse.down(); break;
          case "up": await page.mouse.up(); break;
        }
        return {};
      }

      case "keyboard": {
        const key = (p.key as string) || "";
        const action = (p.action as string) || "press";
        if (action === "type") {
          await page.keyboard.type(key);
        } else if (action === "press") {
          await page.keyboard.press(key);
        } else if (action === "down") {
          await page.keyboard.down(key);
        } else if (action === "up") {
          await page.keyboard.up(key);
        }
        return {};
      }

      case "nav": {
        const url = p.url as string;
        await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
        return {};
      }

      case "wait": {
        const ms = (p.ms as number) || 1000;
        await page.waitForTimeout(ms);
        return {};
      }

      case "screenshot": {
        const buffer = await page.screenshot({ type: "png" });
        const base64 = btoa(
          String.fromCharCode(...new Uint8Array(buffer)),
        );
        return { data: base64 };
      }

      case "run": {
        // Composition: page.tap() — handled by executor, not here
        throw new Error("tap composition must be wired by executor");
      }

      case "capabilities": {
        return {
          protocol: "1.0.0",
          runtime: "playwright",
          kernel: [
            "eval", "pointer", "keyboard", "nav",
            "wait", "screenshot", "tap", "capabilities",
          ],
          stdlib: [
            "click", "type", "hover", "scroll", "pressKey", "select",
            "upload", "dialog", "fetch", "find", "cookies", "download",
            "waitFor", "waitForNetwork", "ssrState", "storage",
          ],
        };
      }

      // ================================================================
      // STDLIB — 16 operations (built on kernel where possible)
      // ================================================================

      case "click": {
        const target = (p.target || p.selector) as string;
        // Try CSS selector first
        try {
          await page.click(target, { timeout: 5000 });
        } catch {
          // Fall back to text match
          await page.getByText(target, { exact: false }).first().click({
            timeout: 5000,
          });
        }
        return {};
      }

      case "type": {
        const selector = p.selector as string;
        const text = p.text as string;
        await page.fill(selector, text);
        // Trigger framework reactivity
        await page.evaluate(
          `((sel, val) => {
            const el = document.querySelector(sel);
            if (!el) return;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          })`,
          { sel: selector, val: text },
        );
        return {};
      }

      case "hover": {
        await page.hover(p.selector as string);
        return {};
      }

      case "scroll": {
        await page.evaluate((sel: string) => {
          document.querySelector(sel)?.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }, p.selector as string);
        return {};
      }

      case "pressKey": {
        await page.keyboard.press(p.key as string);
        return {};
      }

      case "select": {
        await page.selectOption(p.selector as string, p.value as string);
        return {};
      }

      case "upload": {
        const fileInput = await page.$(p.selector as string);
        const files = typeof p.files === "string"
          ? (p.files as string).split(",").map((f: string) => f.trim())
          : p.files;
        await fileInput?.setInputFiles(files);
        return {};
      }

      case "dialog": {
        // Playwright handles dialogs via event listeners
        page.once("dialog", async (dialog: PW) => {
          if (p.accept !== false) {
            await dialog.accept(p.prompt_text as string || undefined);
          } else {
            await dialog.dismiss();
          }
        });
        return {};
      }

      case "fetch": {
        const url = p.url as string;
        return await page.evaluate(
          async (u: string, o: Record<string, unknown>) => {
            const res = await fetch(u, { credentials: "include", ...o });
            return res.json();
          },
          url,
          p.opts || {},
        );
      }

      case "find": {
        // Reuse extension's find logic via eval
        return await page.evaluate(
          (q: string, r: string) => {
            const vw = window.innerWidth, vh = window.innerHeight;
            function region(rect: DOMRect) {
              const cx = rect.x + rect.width / 2,
                cy = rect.y + rect.height / 2;
              const col = cx < vw / 3
                ? "left"
                : cx > (vw * 2) / 3
                ? "right"
                : "center";
              const row = cy < vh / 3
                ? "top"
                : cy > (vh * 2) / 3
                ? "bottom"
                : "middle";
              return `${row}-${col}`;
            }
            function quickSel(el: Element) {
              if (el.id) return "#" + el.id;
              const cls = Array.from(el.classList || [])
                .filter((c: string) => !/^(svelte-|css-|_|sc-)/.test(c))
                .slice(0, 2);
              if (cls.length) {
                return `${el.tagName.toLowerCase()}.${cls.join(".")}`;
              }
              return el.tagName.toLowerCase();
            }
            const candidates = Array.from(document.querySelectorAll("*"))
              .filter((el) => {
                if (
                  (el as HTMLElement).offsetParent === null &&
                  el !== document.body
                ) return false;
                const text = (el as HTMLElement).innerText?.trim() || "";
                if (!text.toLowerCase().includes(q.toLowerCase())) return false;
                if (r && el.getAttribute("role") !== r) return false;
                for (const child of el.children) {
                  if (
                    (child as HTMLElement).innerText?.trim().toLowerCase()
                      .includes(q.toLowerCase()) &&
                    (child as HTMLElement).offsetParent !== null
                  ) return false;
                }
                return true;
              }).slice(0, 20);
            return candidates.map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                tag: el.tagName.toLowerCase(),
                role: el.getAttribute("role") || "",
                text: (el as HTMLElement).innerText?.trim().substring(0, 120) ||
                  "",
                selector: quickSel(el),
                box: {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  w: Math.round(rect.width),
                  h: Math.round(rect.height),
                },
                center: {
                  x: Math.round(rect.x + rect.width / 2),
                  y: Math.round(rect.y + rect.height / 2),
                },
                region: region(rect),
                visible_in_viewport: rect.top < vh && rect.bottom > 0 &&
                  rect.left < vw && rect.right > 0,
              };
            });
          },
          p.query as string,
          (p.role as string) || "",
        );
      }

      case "cookies": {
        return await context.cookies();
      }

      case "download": {
        return await page.evaluate(async (u: string) => {
          const res = await fetch(u, { credentials: "include" });
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("json")) return res.json();
          return res.text();
        }, p.url as string);
      }

      case "waitFor": {
        const selector = p.selector as string;
        const ms = (p.ms as number) || 10000;
        await page.waitForSelector(selector, { timeout: ms });
        return {};
      }

      case "waitForNetwork": {
        await page.waitForLoadState("networkidle");
        return {};
      }

      case "ssrState": {
        return await page.evaluate((name: string | null) => {
          const sanitize = (obj: unknown) =>
            JSON.parse(
              JSON.stringify(obj, (_, v) => v === undefined ? null : v),
            );
          if (name) {
            const val = (window as Record<string, unknown>)[name];
            if (val === undefined) return null;
            try {
              return sanitize(val);
            } catch {
              return null;
            }
          }
          const SSR_NAMES = [
            "__INITIAL_STATE__", "__NEXT_DATA__", "__NUXT__",
            "__NUXT_DATA__", "__PRELOADED_STATE__", "__APP_DATA__",
            "__SSR_DATA__", "__APOLLO_STATE__", "__RELAY_STORE__",
            "__pinia", "__INITIAL_SSR_STATE__",
          ];
          const found: Record<string, unknown> = {};
          for (const n of SSR_NAMES) {
            if ((window as Record<string, unknown>)[n] !== undefined) {
              try {
                found[n] = sanitize(
                  (window as Record<string, unknown>)[n],
                );
              } catch { /* skip */ }
            }
          }
          return Object.keys(found).length ? found : null;
        }, (p.name as string) || null);
      }

      case "storage": {
        const type = (p.type as string) || "local";
        return await page.evaluate((t: string) => {
          const s = t === "session" ? sessionStorage : localStorage;
          const items: Record<string, string | null> = {};
          for (let i = 0; i < s.length; i++) {
            const key = s.key(i)!;
            items[key] = s.getItem(key);
          }
          return items;
        }, type);
      }

      // Tab management (Playwright context)
      case "tab_list": {
        return context.pages().map((p: PW, i: number) => ({
          tabId: i,
          url: p.url(),
          title: "",
        }));
      }

      case "tab_new": {
        page = await context.newPage();
        if (p.url) await page.goto(p.url as string);
        return { tabId: context.pages().length - 1, url: p.url || "about:blank" };
      }

      default:
        throw new Error(`Playwright runtime: unsupported method "${method}"`);
    }
  };

  return {
    send,
    close: async () => {
      await context.close();
    },
  };
}
