/**
 * Page proxy — 25 methods (8 kernel + 17 stdlib) as RPC calls.
 *
 * Each method is a thin wrapper that sends an RPC message to the extension
 * via the provided `send` function. The extension does the actual work.
 *
 * Wire method names use dot notation matching MCP tool names exactly:
 *   page.eval, page.click, page.nav, etc.
 * One name everywhere — no conversion.
 */

export type RpcSend = (
  type: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface Page {
  // Kernel (8 + 1 batch)
  eval(expression: string, ...args: unknown[]): Promise<unknown>;
  evalBatch(expressions: string[]): Promise<unknown[]>;
  pointer(x: number, y: number, action: string, opts?: Record<string, unknown>): Promise<unknown>;
  keyboard(key: string, action: string, mods?: number): Promise<unknown>;
  nav(url: string): Promise<unknown>;
  wait(ms: number): Promise<unknown>;
  screenshot(opts?: Record<string, unknown>): Promise<unknown>;
  tap(site: string, name: string, args?: Record<string, unknown>): Promise<unknown>;
  capabilities(): Promise<unknown>;
  // Stdlib (17)
  click(target: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
  fill(selector: string, text: string): Promise<unknown>;
  hover(selector: string): Promise<unknown>;
  scroll(selector: string): Promise<unknown>;
  pressKey(key: string, mods?: number): Promise<unknown>;
  select(selector: string, value: string): Promise<unknown>;
  upload(selector: string, files: string): Promise<unknown>;
  dialog(accept?: boolean, text?: string): Promise<unknown>;
  fetch(url: string, opts?: Record<string, unknown>): Promise<unknown>;
  find(query: string, role?: string): Promise<unknown>;
  cookies(): Promise<unknown>;
  download(url: string): Promise<unknown>;
  waitFor(selector: string, ms?: number): Promise<unknown>;
  waitForNetwork(ms?: number, idle?: number): Promise<unknown>;
  ssrState(name?: string): Promise<unknown>;
  storage(type?: string): Promise<unknown>;
  copyAll(): Promise<unknown>;
}

export function createPageProxy(send: RpcSend): Page {
  return {
    // Kernel (8 + 1 batch) — abstract names, each runtime translates to native API
    eval: (expression, ...args) => {
      // Taps may pass a function (for extension-native eval) — convert to IIFE string
      const expr = typeof expression === "function"
        ? `(${String(expression)})(${args.map(a => JSON.stringify(a)).join(",")})`
        : String(expression);
      return send("tool", "page.eval", { expression: expr });
    },
    evalBatch: (expressions) =>
      send("tool", "page.evalBatch", { expressions }) as Promise<unknown[]>,
    pointer: (x, y, action, opts) =>
      send("tool", "page.pointer", { x, y, action, ...opts }),
    keyboard: (key, action, mods) =>
      send("tool", "page.keyboard", { key, action, modifiers: mods }),
    nav: (url) => send("tool", "page.nav", { url }),
    wait: (ms) => send("tool", "page.wait", { ms }),
    screenshot: (opts) => send("tool", "page.screenshot", { ...opts }),
    tap: () => { throw new Error("page.tap() must be wired by executor"); },
    capabilities: () => send("tool", "page.capabilities", {}),
    // Stdlib (16)
    click: (target) => send("tool", "page.click", { target }),
    type: (selector, text) => send("tool", "page.type", { selector, text }),
    fill: (selector, text) => send("tool", "page.fill", { selector, text }),
    hover: (selector) => send("tool", "page.hover", { selector }),
    scroll: (selector) => send("tool", "page.scroll", { selector }),
    pressKey: (key, mods) =>
      send("tool", "page.pressKey", { key, modifiers: mods }),
    select: (selector, value) =>
      send("tool", "page.select", { selector, value }),
    upload: (selector, files) =>
      send("tool", "page.upload", { selector, files }),
    dialog: (accept, text) =>
      send("tool", "page.dialog", { accept, prompt_text: text }),
    fetch: (url, opts) => send("tool", "page.fetch", { url, ...opts }),
    find: (query, role) => send("tool", "page.find", { query, role }),
    cookies: () => send("tool", "page.cookies", {}),
    download: (url) => send("tool", "page.download", { url }),
    waitFor: (selector, ms) => send("tool", "page.waitFor", { selector, ms }),
    waitForNetwork: (ms, idle) =>
      send("tool", "page.waitForNetwork", { ms, idle }),
    ssrState: (name) => send("tool", "page.ssrState", { name }),
    storage: (type) => send("tool", "page.storage", { type }),
    copyAll: () => send("tool", "page.copyAll", {}),
  };
}
