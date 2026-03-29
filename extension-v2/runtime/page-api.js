/**
 * Tap Protocol — POSIX-inspired design for interface automation.
 *
 * Architecture: Kernel (8 primitives) + Standard Library (13 named operations)
 *
 * KERNEL — irreducible primitives every runtime must implement:
 *   eval(fn, ...args)                — execute in target context (the universal escape hatch)
 *   pointer(x, y, action, opts?)     — pointer event at coordinates
 *   keyboard(key, action, mods?)     — keyboard event
 *   nav(url)                         — navigate to URL
 *   wait(ms | condition)             — wait for time or condition
 *   screenshot()                     — visual capture
 *   tap(site, name, args?)           — composition (call another tap)
 *   capabilities()                   — declare what this runtime supports
 *
 * STDLIB — named operations built on kernel, runtime may override for optimization:
 *   click(target)       — find element + pointer click
 *   type(selector, text) — focus + keyboard input
 *   hover(selector)     — find element + pointer move
 *   scroll(selector)    — scroll element into view
 *   pressKey(key, mods?) — single key press
 *   select(sel, value)  — dropdown selection
 *   upload(sel, files)  — file input
 *   dialog(accept?, text?) — modal dialog
 *   fetch(url, opts?)   — API call with session
 *   find(query, role?)  — element search by text
 *   cookies()           — session state
 *   download(url)       — fetch + parse response
 *   waitFor(sel, ms?)   — wait for element
 *   waitForNetwork(ms?, idle?) — wait for network settle
 *   getSSRState(name?)  — extract SSR globals
 *   storage(type?)      — read local/session storage
 */

// ============================================================================
// KERNEL — 8 irreducible primitives (Chrome Extension runtime implementation)
// ============================================================================

/**
 * Create kernel primitives bound to a Chrome tab.
 * This is the runtime-specific layer. A different runtime (Android, iOS)
 * would provide a different createKernel with the same interface.
 */
function createKernel(tabId, { cdpClick, withDebugger } = {}) {
  let currentUrl = ''
  const wd = withDebugger || _fallbackWithDebugger

  return {
    /** Execute a function in the page's JS context. The universal escape hatch. */
    async eval(fn, ...args) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: fn,
        args,
        world: 'MAIN'
      })
      return results?.[0]?.result
    },

    /**
     * Pointer event at coordinates.
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @param {'click'|'move'|'down'|'up'} action - Pointer action
     */
    async pointer(x, y, action = 'click') {
      if (action === 'click') {
        if (cdpClick) {
          await cdpClick(tabId, x, y)
        } else {
          await _fallbackClick(tabId, x, y)
        }
      } else if (action === 'move') {
        await wd(async () => {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseMoved', x, y
          })
        })
      } else if (action === 'down') {
        await wd(async () => {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mousePressed', x, y, button: 'left', clickCount: 1
          })
        })
      } else if (action === 'up') {
        await wd(async () => {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
            type: 'mouseReleased', x, y, button: 'left', clickCount: 1
          })
        })
      }
    },

    /**
     * Keyboard event.
     * @param {string} key - Key name or character
     * @param {'press'|'down'|'up'|'type'} action - Keyboard action
     * @param {number} [modifiers=0] - Modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
     */
    async keyboard(key, action = 'press', modifiers = 0) {
      const mapped = KEY_MAP[key] || { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.charCodeAt(0) }

      await wd(async () => {
        if (action === 'type') {
          // Type a string character by character
          for (const char of key) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyDown', text: char, key: char, code: `Key${char.toUpperCase()}`
            })
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type: 'keyUp', key: char, code: `Key${char.toUpperCase()}`
            })
          }
        } else if (action === 'down') {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', modifiers, ...mapped
          })
        } else if (action === 'up') {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', modifiers, ...mapped
          })
        } else {
          // 'press' = down + up
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', modifiers, ...mapped
          })
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', modifiers, ...mapped
          })
        }
      })
    },

    /** Navigate to URL. Waits for full page idle. */
    async nav(url) {
      await chrome.tabs.update(tabId, { url })
      await waitForTabLoad(tabId)
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => new Promise(resolve => {
            const onReady = () => {
              if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(resolve, { timeout: 5000 })
              } else {
                setTimeout(resolve, 500)
              }
            }
            if (document.readyState === 'complete') onReady()
            else window.addEventListener('load', onReady, { once: true })
          }),
          world: 'MAIN'
        })
      } catch { /* scripting may fail on chrome:// — continue */ }
      const tab = await chrome.tabs.get(tabId)
      currentUrl = tab.url || url
    },

    /** Wait for milliseconds or a function condition. */
    async wait(msOrFn, timeoutMs = 10000) {
      if (typeof msOrFn === 'number') {
        return new Promise(resolve => setTimeout(resolve, msOrFn))
      }
      // Function condition: poll until truthy
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const results = await chrome.scripting.executeScript({
          target: { tabId }, func: msOrFn, world: 'MAIN'
        })
        if (results?.[0]?.result) return results[0].result
        await new Promise(r => setTimeout(r, 300))
      }
      throw new Error(`wait: condition not met within ${timeoutMs}ms`)
    },

    /** Capture screenshot. Returns base64 data URL. */
    async screenshot() {
      return await chrome.tabs.captureVisibleTab(null, { format: 'png' })
    },

    /** Run another tap. Wired by executor. */
    async tap(site, name, args = {}) {
      throw new Error('page.tap() not wired — must be set by executor')
    },

    /** Declare runtime capabilities. */
    capabilities() {
      return {
        runtime: 'chrome-extension',
        kernel: ['eval', 'pointer', 'keyboard', 'nav', 'wait', 'screenshot', 'tap', 'capabilities'],
        stdlib: ['click', 'type', 'hover', 'scroll', 'pressKey', 'select', 'upload', 'dialog',
          'fetch', 'find', 'cookies', 'download', 'waitFor', 'waitForNetwork', 'getSSRState', 'storage'],
      }
    },

    // Expose for stdlib use
    _wd: wd,
    _tabId: tabId,
    _getCurrentUrl: () => currentUrl || chrome.tabs.get(tabId).then(t => t.url),
  }
}

// ============================================================================
// STDLIB — named operations built on kernel (runtime may override)
// ============================================================================

/**
 * Create standard library operations from kernel primitives.
 * Each operation is a named pattern composed from kernel calls.
 * The Chrome runtime overrides some for native CDP performance.
 */
function createStdlib(kernel) {
  const tabId = kernel._tabId

  return {
    /**
     * Click an element. Accepts CSS selector or visible text.
     * Stdlib: eval(find element) → pointer(x, y, 'click')
     */
    async click(target) {
      const pos = await kernel.eval((t) => {
        let el = null
        try { el = document.querySelector(t) } catch {}
        if (!el) {
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
          let best = null
          while (walker.nextNode()) {
            const node = walker.currentNode
            if (node.offsetParent === null) continue
            const nodeText = node.innerText?.trim()
            if (nodeText && nodeText.includes(t)) {
              if (!best || node.innerText.length <= best.innerText.length) best = node
            }
          }
          el = best
        }
        if (!el) return null
        const rect = el.getBoundingClientRect()
        let cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
        if (cy < 0 || cy > innerHeight || cx < 0 || cx > innerWidth) {
          el.scrollIntoView({ block: 'center', behavior: 'instant' })
          const r = el.getBoundingClientRect()
          cx = r.x + r.width / 2; cy = r.y + r.height / 2
        }
        const hit = document.elementFromPoint(cx, cy)
        if (hit && !el.contains(hit) && hit !== el) {
          el.scrollIntoView({ block: 'end', behavior: 'instant' })
          const r = el.getBoundingClientRect()
          cx = r.x + r.width / 2; cy = r.y + r.height / 2
        }
        return { x: cx, y: cy }
      }, target)

      if (!pos) throw new Error(`click: target "${target}" not found`)
      await kernel.pointer(pos.x, pos.y, 'click')
    },

    /**
     * Type text into an element.
     * Stdlib: eval(focus + select) → keyboard(Backspace) → keyboard(text, 'type') → eval(trigger reactivity)
     */
    async type(selector, text) {
      await kernel.eval((sel) => {
        const el = document.querySelector(sel)
        if (!el) return
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        el.focus()
        el.click()
        if (el.select) el.select()
        else if (el.contentEditable === 'true') {
          const range = document.createRange()
          range.selectNodeContents(el)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
        }
      }, selector)
      await kernel.wait(100)
      await kernel.keyboard('Backspace', 'press')
      await kernel.keyboard(text, 'type')
      // Trigger framework reactivity (Vue, React)
      await kernel.eval((sel, val) => {
        const el = document.querySelector(sel)
        if (!el) return
        if ('value' in el) {
          const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
          if (setter) setter.call(el, val)
        }
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }, selector, text)
    },

    /**
     * Hover over an element.
     * Stdlib: eval(find + coords) → pointer(x, y, 'move')
     */
    async hover(selector) {
      const pos = await kernel.eval((sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      }, selector)
      if (!pos) throw new Error(`hover: "${selector}" not found`)
      await kernel.pointer(pos.x, pos.y, 'move')
    },

    /**
     * Scroll element into view.
     * Stdlib: eval(scrollIntoView)
     */
    async scroll(selector) {
      const ok = await kernel.eval((sel) => {
        const el = document.querySelector(sel)
        if (!el) return false
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return true
      }, selector)
      if (!ok) throw new Error(`scroll: "${selector}" not found`)
    },

    /**
     * Press a single key.
     * Stdlib: keyboard(key, 'press', modifiers)
     */
    async pressKey(key, modifiers = 0) {
      await kernel.keyboard(key, 'press', modifiers)
    },

    /**
     * Select an option in a <select> dropdown.
     * Stdlib: eval(set value + dispatch events)
     */
    async select(selector, value) {
      const ok = await kernel.eval((sel, val) => {
        const el = document.querySelector(sel)
        if (!el) return false
        el.value = val
        el.dispatchEvent(new Event('change', { bubbles: true }))
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }, selector, value)
      if (!ok) throw new Error(`select: "${selector}" not found`)
    },

    /**
     * Upload files to a file input.
     * Chrome override: uses CDP DOM.setFileInputFiles (no kernel equivalent).
     */
    async upload(selector, files) {
      const fileList = typeof files === 'string' ? files.split(',').map(f => f.trim()) : files
      await kernel._wd(async () => {
        const doc = await chrome.debugger.sendCommand({ tabId }, 'DOM.getDocument', {})
        const node = await chrome.debugger.sendCommand({ tabId }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId, selector
        })
        await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
          nodeId: node.nodeId, files: fileList
        })
      })
    },

    /**
     * Handle a JavaScript dialog.
     * Chrome override: uses CDP Page.handleJavaScriptDialog.
     */
    async dialog(accept = true, promptText) {
      await kernel._wd(async () => {
        const params = { accept }
        if (promptText !== undefined) params.promptText = promptText
        await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', params)
      })
    },

    /**
     * Fetch URL with page's session cookies.
     * Stdlib: eval(fetch)
     */
    async fetch(url, opts = {}) {
      return await kernel.eval(async (u, o) => {
        const res = await fetch(u, { credentials: 'include', ...o })
        return res.json()
      }, url, opts)
    },

    /**
     * Find elements by visible text.
     * Stdlib: eval(DOM search)
     */
    async find(query, role) {
      return await kernel.eval((q, r) => {
        const vw = window.innerWidth, vh = window.innerHeight

        function region(rect) {
          const cx = rect.x + rect.width / 2, cy = rect.y + rect.height / 2
          const col = cx < vw / 3 ? 'left' : cx > vw * 2 / 3 ? 'right' : 'center'
          const row = cy < vh / 3 ? 'top' : cy > vh * 2 / 3 ? 'bottom' : 'middle'
          return `${row}-${col}`
        }

        function quickSel(el) {
          if (el.id) return '#' + el.id
          const testId = el.getAttribute('data-testid') || el.getAttribute('data-test-id')
          if (testId) return `[data-testid="${testId}"]`
          if (el.name && el.tagName !== 'DIV') return `${el.tagName.toLowerCase()}[name="${el.name}"]`
          const cls = Array.from(el.classList || []).filter(c => !/^(svelte-|css-|_|sc-)/.test(c)).slice(0, 2)
          if (cls.length) return `${el.tagName.toLowerCase()}.${cls.join('.')}`
          return el.tagName.toLowerCase()
        }

        const candidates = Array.from(document.querySelectorAll('*')).filter(el => {
          if (el.offsetParent === null && el !== document.body) return false
          const text = el.innerText?.trim() || ''
          if (!text.toLowerCase().includes(q.toLowerCase())) return false
          if (r && el.getAttribute('role') !== r) return false
          for (const child of el.children) {
            if (child.innerText?.trim().toLowerCase().includes(q.toLowerCase()) && child.offsetParent !== null) return false
          }
          return true
        }).slice(0, 20)

        return candidates.map(el => {
          const rect = el.getBoundingClientRect()
          return {
            tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
            text: el.innerText?.trim().substring(0, 120) || '',
            selector: quickSel(el),
            box: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
            center: { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) },
            region: region(rect),
            visible_in_viewport: rect.top < vh && rect.bottom > 0 && rect.left < vw && rect.right > 0
          }
        })
      }, query, role || '') || []
    },

    /**
     * Read cookies for the current page's domain.
     * Chrome override: uses chrome.cookies API (not available via eval).
     */
    async cookies() {
      const url = await kernel._getCurrentUrl()
      return await chrome.cookies.getAll({ url })
    },

    /**
     * Download a URL using the page's session.
     * Stdlib: eval(fetch + parse)
     */
    async download(url) {
      return await kernel.eval(async (u) => {
        const res = await fetch(u, { credentials: 'include' })
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('json')) return res.json()
        return res.text()
      }, url)
    },

    /**
     * Wait for a CSS selector to appear.
     * Stdlib: wait(condition)
     */
    async waitFor(selector, timeoutMs = 10000) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const found = await kernel.eval((sel) => !!document.querySelector(sel), selector)
        if (found) return
        await kernel.wait(300)
      }
      throw new Error(`waitFor: "${selector}" not found within ${timeoutMs}ms`)
    },

    /**
     * Wait until network activity settles.
     * Stdlib: eval(PerformanceObserver)
     */
    async waitForNetwork(timeoutMs = 10000, idleMs = 500) {
      await kernel.eval((timeout, idle) => new Promise(resolve => {
        let timer = setTimeout(resolve, idle)
        const deadline = Date.now() + timeout
        const observer = new PerformanceObserver(() => {
          clearTimeout(timer)
          if (Date.now() >= deadline) { resolve(); return }
          timer = setTimeout(resolve, idle)
        })
        observer.observe({ entryTypes: ['resource'] })
        setTimeout(() => { observer.disconnect(); resolve() }, timeout)
      }), timeoutMs, idleMs)
    },

    /**
     * Extract SSR state from window globals.
     * Stdlib: eval(read window globals)
     */
    async getSSRState(name) {
      return await kernel.eval((target) => {
        const sanitize = (obj) => JSON.parse(JSON.stringify(obj, (_, v) => v === undefined ? null : v))

        if (target) {
          const val = window[target]
          if (val === undefined) return null
          try { return sanitize(val) } catch { return null }
        }

        const SSR_NAMES = ['__INITIAL_STATE__', '__NEXT_DATA__', '__NUXT__', '__NUXT_DATA__',
          '__PRELOADED_STATE__', '__APP_DATA__', '__SSR_DATA__', '__APOLLO_STATE__',
          '__RELAY_STORE__', '__pinia', '__INITIAL_SSR_STATE__']
        const found = {}
        for (const n of SSR_NAMES) {
          if (window[n] !== undefined) {
            try { found[n] = sanitize(window[n]) } catch {}
          }
        }
        for (const key of Object.getOwnPropertyNames(window)) {
          if (/^__[A-Z_]+__$/.test(key) && !(key in found) && typeof window[key] === 'object' && window[key] !== null) {
            try { found[key] = sanitize(window[key]) } catch {}
          }
        }
        return Object.keys(found).length ? found : null
      }, name || null)
    },

    /**
     * Read localStorage or sessionStorage.
     * Stdlib: eval(read storage)
     */
    async storage(type = 'local') {
      return await kernel.eval((t) => {
        const s = t === 'session' ? sessionStorage : localStorage
        const items = {}
        for (let i = 0; i < s.length; i++) {
          const key = s.key(i)
          items[key] = s.getItem(key)
        }
        return items
      }, type) || {}
    },
  }
}

// ============================================================================
// PUBLIC API — merges kernel + stdlib into the page object
// ============================================================================

/**
 * Create a page API bound to a specific tab.
 * @param {number} tabId - Chrome tab ID
 * @param {object} opts - Options
 * @param {function} opts.cdpClick - CDP click function(tabId, x, y) from background.js
 * @param {function} opts.withDebugger - Debugger wrapper (fn) => Promise from background.js
 * @returns {object} page API object — kernel + stdlib merged into a flat namespace
 */
export function createPageAPI(tabId, { cdpClick, withDebugger } = {}) {
  const kernel = createKernel(tabId, { cdpClick, withDebugger })
  const stdlib = createStdlib(kernel)

  // Merge into flat page object: kernel primitives + stdlib operations
  // Stdlib overrides kernel names where both exist (e.g. stdlib.click > kernel.pointer)
  const page = {
    // --- Kernel primitives (exposed for advanced use) ---
    eval: kernel.eval,
    pointer: kernel.pointer,
    keyboard: kernel.keyboard,
    nav: kernel.nav,
    wait: kernel.wait,
    screenshot: kernel.screenshot,
    tap: kernel.tap,
    capabilities: kernel.capabilities,

    // --- Stdlib operations (the primary tap scripting interface) ---
    click: stdlib.click,
    type: stdlib.type,
    hover: stdlib.hover,
    scroll: stdlib.scroll,
    pressKey: stdlib.pressKey,
    select: stdlib.select,
    upload: stdlib.upload,
    dialog: stdlib.dialog,
    fetch: stdlib.fetch,
    find: stdlib.find,
    cookies: stdlib.cookies,
    download: stdlib.download,
    waitFor: stdlib.waitFor,
    waitForNetwork: stdlib.waitForNetwork,
    getSSRState: stdlib.getSSRState,
    storage: stdlib.storage,
  }

  return page
}

// ============================================================================
// SHARED — key map + helpers
// ============================================================================

const KEY_MAP = {
  Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Home: { key: 'Home', code: 'Home', windowsVirtualKeyCode: 36 },
  End: { key: 'End', code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { key: 'PageUp', code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
}

/** Wait for a tab to finish loading. */
function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve()
    }, 30000)
  })
}

/** Fallback click when no cdpClick injected. */
async function _fallbackClick(tabId, x, y) {
  await chrome.debugger.attach({ tabId }, '1.3')
  try {
    const params = { x, y, button: 'left', clickCount: 1 }
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...params })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...params })
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {})
  }
}

/** Fallback withDebugger when none injected. */
async function _fallbackWithDebugger(fn) {
  return await fn()
}
