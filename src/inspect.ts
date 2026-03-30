/**
 * Inspect tools — page analysis via page.eval() RPC.
 *
 * Migrated from extension/background.js. Each tool was previously
 * bypassing the kernel abstraction with direct extension APIs.
 * Now they go through page.eval(), making them runtime-independent
 * (works on Chrome Extension AND Playwright).
 *
 * Pattern: serialized IIFE strings passed to page.eval().
 * Functions must be self-contained (zero closures, zero imports).
 */

import { createPageProxy, type RpcSend } from "./page.ts";

/** Dispatch an inspect tool call through page.eval(). */
export async function handleInspectTool(
  name: string,
  args: Record<string, unknown>,
  send: RpcSend,
): Promise<unknown> {
  const page = createPageProxy(send);

  switch (name) {
    case "inspect.page": {
      return await page.eval(`(() => ({
  url: location.href, title: document.title, readyState: document.readyState,
  viewport: { w: window.innerWidth, h: window.innerHeight },
  scroll: { x: window.scrollX, y: window.scrollY }
}))()`);
    }

    case "inspect.element": {
      const selector = args.selector as string;
      if (!selector) throw new Error("element: missing selector");
      return await page.eval(`((sel) => {
  const el = document.querySelector(sel)
  if (!el) return null
  const rect = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    tag: el.tagName.toLowerCase(), id: el.id || null,
    classes: Array.from(el.classList),
    attrs: Object.fromEntries(Array.from(el.attributes).map(a => [a.name, a.value.substring(0, 200)])),
    text: el.innerText?.trim().substring(0, 300) || '',
    box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    visible: el.offsetParent !== null, editable: el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA',
    disabled: el.disabled || false, value: el.value?.substring(0, 200) || null,
    display: cs.display, position: cs.position, overflow: cs.overflow
  }
})(${JSON.stringify(selector)})`);
    }

    case "inspect.a11y": {
      return await page.eval(`(() => {
  const items = []
  const sels = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [contenteditable="true"], [tabindex]'
  document.querySelectorAll(sels).forEach(el => {
    if (el.offsetParent === null) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    function qs(e) {
      if (e.id) return '#' + e.id
      const tid = e.getAttribute('data-testid')
      if (tid) return '[data-testid="' + tid + '"]'
      if (e.name) return e.tagName.toLowerCase() + '[name="' + e.name + '"]'
      const cls = Array.from(e.classList || []).filter(c => !/^(svelte-|css-|_|sc-)/.test(c)).slice(0, 2)
      if (cls.length) return e.tagName.toLowerCase() + '.' + cls.join('.')
      return e.tagName.toLowerCase()
    }
    items.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || el.type || el.tagName.toLowerCase(),
      name: el.getAttribute('aria-label') || el.innerText?.trim().substring(0, 80) || el.placeholder || el.name || '',
      selector: qs(el),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      disabled: el.disabled || false, value: el.value?.substring(0, 100) || null
    })
  })
  return { interactive: items }
})()`);
    }

    case "inspect.dom": {
      const selector = (args.selector as string) || "body";
      const depth = (args.depth as number) || 6;
      const summary = args.summary !== false;
      return await page.eval(`((sel, depth, doSummary) => {
  const root = document.querySelector(sel)
  if (!root) return null
  function walk(el, d) {
    if (d > depth) return null
    if (el.offsetParent === null && el !== document.body && el.tagName !== 'HTML' && el.tagName !== 'HEAD') return null
    const tag = el.tagName.toLowerCase()
    if (['script', 'style', 'noscript', 'svg', 'path', 'link', 'meta'].includes(tag)) return null
    const node = { tag }
    if (el.id) node.id = el.id
    if (doSummary) {
      const role = el.getAttribute('role')
      if (role) node.role = role
      const ariaLabel = el.getAttribute('aria-label')
      if (ariaLabel) node.label = ariaLabel
      const textNode = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
        ? el.childNodes[0].textContent.trim().substring(0, 80) : null
      if (textNode) node.text = textNode
      if (['input', 'button', 'a', 'select', 'textarea'].includes(tag)) {
        if (el.className) node.cls = String(el.className).substring(0, 60)
        if (el.name) node.name = el.name
        if (el.type) node.type = el.type
        if (el.href) node.href = el.href
        if (el.placeholder) node.placeholder = el.placeholder
      }
    } else {
      const text = el.innerText?.substring(0, 200) || ''
      if (text) node.text = text
    }
    const children = []
    for (const child of el.children) { const c = walk(child, d + 1); if (c) children.push(c) }
    if (children.length) node.children = children
    return node
  }
  return walk(root, 0)
})(${JSON.stringify(selector)}, ${JSON.stringify(depth)}, ${JSON.stringify(summary)})`);
    }

    case "inspect.globals": {
      return await page.eval(`(() => {
  const iframe = document.createElement('iframe')
  iframe.style.display = 'none'
  document.body.appendChild(iframe)
  const defaults = new Set(Object.getOwnPropertyNames(iframe.contentWindow))
  document.body.removeChild(iframe)
  const custom = Object.getOwnPropertyNames(window).filter(n => !defaults.has(n))
  return custom.slice(0, 200)
})()`);
    }

    case "inspect.download": {
      const url = args.url as string;
      if (!url) throw new Error("download: missing url");
      const result = await page.eval(`(async (u) => {
  const res = await fetch(u, { credentials: 'include' })
  const blob = await res.blob()
  const reader = new FileReader()
  return new Promise(resolve => {
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  })
})(${JSON.stringify(url)})`);
      return { data: result, output: (args.output as string) || "/tmp/tap-download" };
    }

    case "inspect.apiLog": {
      const result = await page.eval(`(() => {
  const log = window.__tap_api_log || []
  window.__tap_api_log = []
  return log
})()`);
      return result || [];
    }

    case "inspect.toasts": {
      try {
        const result = await page.eval(`(() => {
  const toasts = window.__tap_toasts || []
  window.__tap_toasts = []
  return toasts
})()`);
        return result || [];
      } catch {
        return [];
      }
    }

    default:
      throw new Error(`Unknown inspect tool: ${name}`);
  }
}
