/**
 * Page proxy — 24 methods (8 kernel + 16 stdlib) as RPC calls.
 *
 * Each method is a thin wrapper that sends an RPC message to the extension
 * via the provided `send` function. The extension does the actual work.
 */

export type RpcSend = (
  type: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

export interface Page {
  // Kernel (8)
  eval(expression: string, ...args: unknown[]): Promise<unknown>;
  pointer(x: number, y: number, action: string, opts?: Record<string, unknown>): Promise<unknown>;
  keyboard(key: string, action: string, mods?: number): Promise<unknown>;
  nav(url: string): Promise<unknown>;
  wait(ms: number): Promise<unknown>;
  screenshot(opts?: Record<string, unknown>): Promise<unknown>;
  tap(site: string, name: string, args?: Record<string, unknown>): Promise<unknown>;
  capabilities(): Promise<unknown>;
  // Stdlib (16)
  click(target: string): Promise<unknown>;
  type(selector: string, text: string): Promise<unknown>;
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
}

export function createPageProxy(send: RpcSend): Page {
  return {
    // Kernel — route through CDP, not tool handler
    eval: async (expression, ...args) => {
      // Extension's Runtime.evaluate wraps in chrome.scripting.executeScript
      const r = await send("cdp", "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }) as Record<string, unknown>;
      // Unwrap: extension returns { result: { value } } or scripting wrapper
      const result = r?.result as Record<string, unknown> | undefined;
      return result?.value ?? r;
    },
    pointer: (x, y, action, opts) =>
      send("cdp", "Input.dispatchMouseEvent", {
        type: action === "click" ? "mousePressed" : action,
        x, y, button: "left", clickCount: 1, ...opts,
      }),
    keyboard: (key, action, mods) =>
      send("cdp", "Input.dispatchKeyEvent", {
        type: action === "down" ? "keyDown" : action === "up" ? "keyUp" : "char",
        key, modifiers: mods,
      }),
    nav: (url) => send("cdp", "Page.navigate", { url }),
    wait: (ms) => new Promise((r) => setTimeout(r, ms as number)),
    screenshot: (opts) =>
      send("cdp", "Page.captureScreenshot", { format: "jpeg", quality: 50, ...opts }),
    tap: (site, name, args) =>
      send("tool", "run", { site, name, args }),
    capabilities: () => send("tool", "capabilities", {}),
    // Stdlib — these are tool commands the extension handles
    click: (target) => send("tool", "click", { target }),
    type: (selector, text) => send("tool", "type", { selector, text }),
    hover: (selector) => send("tool", "hover", { selector }),
    scroll: (selector) => send("tool", "scroll", { selector }),
    pressKey: (key, mods) =>
      send("tool", "pressKey", { key, modifiers: mods }),
    select: (selector, value) =>
      send("tool", "select", { selector, value }),
    upload: (selector, files) =>
      send("tool", "upload", { selector, files }),
    dialog: (accept, text) =>
      send("tool", "dialog", { accept, prompt_text: text }),
    fetch: (url, opts) => send("tool", "fetch", { url, ...opts }),
    find: (query, role) => send("tool", "find", { query, role }),
    cookies: () => send("tool", "cookies", {}),
    download: (url) => send("tool", "download", { url }),
    waitFor: (selector, ms) => send("tool", "waitFor", { selector, ms }),
    waitForNetwork: (ms, idle) =>
      send("tool", "waitForNetwork", { ms, idle }),
    ssrState: (name) => send("tool", "ssrState", { name }),
    storage: (type) => send("tool", "storage", { type }),
  };
}
