/**
 * page API — the 21 system calls a .tap.js can use (Tap runtime).
 *
 * Scripting mode (undetectable): nav, wait, waitFor, eval, fetch, screenshot, cookies, scroll, select, download, find, waitForNetwork, getSSRState, storage
 * Debugger mode (ms-level attach/detach): click, type, upload, hover, pressKey, dialog
 */

/**
 * Create a page API bound to a specific tab.
 * @param {number} tabId - Chrome tab ID
 * @param {object} opts - Options
 * @param {function} opts.cdpClick - CDP click function(tabId, x, y) from background.js
 * @param {function} opts.withDebugger - Debugger wrapper (fn) => Promise from background.js
 * @returns {object} page API object
 */
export function createPageAPI(tabId, { cdpClick, withDebugger } = {}) {
  let currentUrl = ''

  const page = {
    /** Navigate to URL. Waits for full page idle (undetectable). */
    async nav(url) {
      await chrome.tabs.update(tabId, { url })
      await waitForTabLoad(tabId)
      // Wait for page JS to finish + browser idle — blends with natural page lifecycle
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
      } catch { /* scripting may fail on chrome:// or restricted pages — continue */ }
      const tab = await chrome.tabs.get(tabId)
      currentUrl = tab.url || url
    },

    /** Wait fixed milliseconds. */
    async wait(ms) {
      return new Promise(resolve => setTimeout(resolve, ms))
    },

    /** Wait for a CSS selector to appear in the page. Polls via chrome.scripting. */
    async waitFor(selector, timeoutMs = 10000) {
      const start = Date.now()
      while (Date.now() - start < timeoutMs) {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (sel) => !!document.querySelector(sel),
          args: [selector],
          world: 'MAIN'
        })
        if (results?.[0]?.result) return
        await new Promise(r => setTimeout(r, 300))
      }
      throw new Error(`waitFor: "${selector}" not found within ${timeoutMs}ms`)
    },

    /**
     * Click an element. Accepts CSS selector or visible text.
     * Uses CDP native Input.dispatchMouseEvent (isTrusted=true).
     */
    async click(target) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (t) => {
          // Try as CSS selector first
          let el = null
          try { el = document.querySelector(t) } catch {}
          // Fallback: find by visible text (leaf-first, shortest match)
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
        },
        args: [target],
        world: 'MAIN'
      })

      const pos = results?.[0]?.result
      if (!pos) throw new Error(`click: target "${target}" not found`)

      if (cdpClick) {
        await cdpClick(tabId, pos.x, pos.y)
      } else {
        await _fallbackClick(tabId, pos.x, pos.y)
      }
    },

    /**
     * Type text into an element (by CSS selector).
     * Clears existing content, types via CDP keyboard events, triggers framework reactivity.
     */
    async type(selector, text) {
      // Focus, scroll into view, and select existing content
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
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
        },
        args: [selector],
        world: 'MAIN'
      })
      await new Promise(r => setTimeout(r, 100))

      // Delete selected content, then type new text via CDP
      const wd = withDebugger || _fallbackWithDebugger
      await wd(async () => {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
        })
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
        })
        for (const char of text) {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', text: char, key: char, code: `Key${char.toUpperCase()}`
          })
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: char, code: `Key${char.toUpperCase()}`
          })
        }
      })

      // Trigger framework reactivity (Vue, React)
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, val) => {
          const el = document.querySelector(sel)
          if (!el) return
          if ('value' in el) {
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            if (setter) setter.call(el, val)
          }
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        },
        args: [selector, text],
        world: 'MAIN'
      })
    },

    /**
     * Upload files to a file input element.
     * Uses CDP DOM.setFileInputFiles.
     */
    async upload(selector, files) {
      const fileList = typeof files === 'string' ? files.split(',').map(f => f.trim()) : files

      const wd = withDebugger || _fallbackWithDebugger
      await wd(async () => {
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
     * Execute a function in the page's JS context. Uses chrome.scripting (undetectable).
     * @param {Function} fn - Function to execute in page context
     * @param {...any} args - Arguments to pass to the function
     * @returns {any} Return value from the function
     */
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
     * Fetch a URL with the page's cookies. Uses chrome.scripting → page fetch() (undetectable).
     * @returns {any} Parsed JSON response
     */
    async fetch(url, opts = {}) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (u, o) => {
          const res = await fetch(u, { credentials: 'include', ...o })
          return res.json()
        },
        args: [url, opts],
        world: 'MAIN'
      })
      return results?.[0]?.result
    },

    /** Capture screenshot of visible area. Returns base64 data URL. */
    async screenshot() {
      return await chrome.tabs.captureVisibleTab(null, { format: 'png' })
    },

    /** Read cookies for the current page's domain. */
    async cookies() {
      const url = currentUrl || (await chrome.tabs.get(tabId)).url
      return await chrome.cookies.getAll({ url })
    },

    /** Scroll an element into view. */
    async scroll(selector) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel)
          if (!el) return false
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return true
        },
        args: [selector],
        world: 'MAIN'
      })
      if (!results?.[0]?.result) throw new Error(`scroll: "${selector}" not found`)
    },

    /**
     * Hover over an element. Triggers CSS :hover, tooltips, dropdown menus.
     * Uses CDP native Input.dispatchMouseEvent (isTrusted=true).
     */
    async hover(selector) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel)
          if (!el) return null
          el.scrollIntoView({ block: 'center', behavior: 'instant' })
          const rect = el.getBoundingClientRect()
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
        },
        args: [selector],
        world: 'MAIN'
      })
      const pos = results?.[0]?.result
      if (!pos) throw new Error(`hover: "${selector}" not found`)

      const wd = withDebugger || _fallbackWithDebugger
      await wd(async () => {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: pos.x, y: pos.y
        })
      })
    },

    /**
     * Press a key (Enter, Tab, Escape, arrows, etc.).
     * Uses CDP native Input.dispatchKeyEvent (isTrusted=true).
     * @param {string} key - Key name (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown')
     * @param {number} [modifiers=0] - Modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
     */
    async pressKey(key, modifiers = 0) {
      const keyMap = {
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
      const mapped = keyMap[key] || { key, code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.charCodeAt(0) }

      const wd = withDebugger || _fallbackWithDebugger
      await wd(async () => {
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyDown', modifiers, ...mapped
        })
        await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
          type: 'keyUp', modifiers, ...mapped
        })
      })
    },

    /**
     * Select an option in a <select> dropdown.
     * @param {string} selector - CSS selector of the <select> element
     * @param {string} value - Value to select
     */
    async select(selector, value) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, val) => {
          const el = document.querySelector(sel)
          if (!el) return false
          el.value = val
          el.dispatchEvent(new Event('change', { bubbles: true }))
          el.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        },
        args: [selector, value],
        world: 'MAIN'
      })
      if (!results?.[0]?.result) throw new Error(`select: "${selector}" not found`)
    },

    /**
     * Download a URL using the page's session (cookies, auth).
     * @param {string} url - URL to download
     * @returns {any} Parsed response (JSON if possible, otherwise text)
     */
    async download(url) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (u) => {
          const res = await fetch(u, { credentials: 'include' })
          const ct = res.headers.get('content-type') || ''
          if (ct.includes('json')) return res.json()
          return res.text()
        },
        args: [url],
        world: 'MAIN'
      })
      return results?.[0]?.result
    },

    /**
     * Handle a JavaScript dialog (alert/confirm/prompt).
     * @param {boolean} [accept=true] - Accept or dismiss the dialog
     * @param {string} [promptText] - Text to enter for prompt dialogs
     */
    async dialog(accept = true, promptText) {
      const wd = withDebugger || _fallbackWithDebugger
      await wd(async () => {
        const params = { accept }
        if (promptText !== undefined) params.promptText = promptText
        await chrome.debugger.sendCommand({ tabId }, 'Page.handleJavaScriptDialog', params)
      })
    },

    /**
     * Find elements by visible text. Returns array of matches with selectors and positions.
     * @param {string} query - Text to search for (case-insensitive substring match)
     * @param {string} [role] - Optional ARIA role filter
     * @returns {Array<{tag, role, text, selector, box, center, region, visible_in_viewport}>}
     */
    async find(query, role) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (q, r) => {
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
        },
        args: [query, role || ''],
        world: 'MAIN'
      })
      return results?.[0]?.result || []
    },

    /**
     * Wait until network activity settles (no new requests for idleMs).
     * Uses PerformanceObserver — pure scripting mode, undetectable.
     * @param {number} [timeoutMs=10000] - Max wait time
     * @param {number} [idleMs=500] - Quiet period to consider network idle
     */
    async waitForNetwork(timeoutMs = 10000, idleMs = 500) {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (timeout, idle) => new Promise(resolve => {
          let timer = setTimeout(resolve, idle)
          const deadline = Date.now() + timeout
          const observer = new PerformanceObserver(() => {
            clearTimeout(timer)
            if (Date.now() >= deadline) { resolve(); return }
            timer = setTimeout(resolve, idle)
          })
          observer.observe({ entryTypes: ['resource'] })
          setTimeout(() => { observer.disconnect(); resolve() }, timeout)
        }),
        args: [timeoutMs, idleMs],
        world: 'MAIN'
      })
    },

    /**
     * Extract SSR state from window globals. Auto-sanitizes undefined→null.
     * @param {string} [name] - Specific global name (e.g. '__INITIAL_STATE__'). If omitted, auto-discovers all SSR globals.
     * @returns {object|null} Parsed state object, or map of {globalName: state} if no name specified
     */
    async getSSRState(name) {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (target) => {
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
        },
        args: [name || null],
        world: 'MAIN'
      })
      return results?.[0]?.result
    },

    /**
     * Read localStorage or sessionStorage.
     * @param {string} [type='local'] - 'local' or 'session'
     * @returns {object} Key-value map of storage items
     */
    async storage(type = 'local') {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (t) => {
          const s = t === 'session' ? sessionStorage : localStorage
          const items = {}
          for (let i = 0; i < s.length; i++) {
            const key = s.key(i)
            items[key] = s.getItem(key)
          }
          return items
        },
        args: [type],
        world: 'MAIN'
      })
      return results?.[0]?.result || {}
    },

    /**
     * Run another tap (composition).
     * @param {string} site - Site name
     * @param {string} name - Tap name
     * @param {object} args - Arguments
     * @returns {Array} Rows from the tap
     */
    async tap(site, name, args = {}) {
      // This is wired up by the executor — placeholder here
      throw new Error('page.tap() not wired — must be set by executor')
    }
  }

  return page
}

// --- Helpers ---

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

/** Fallback click when no cdpClick injected (attach/click/detach). */
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
  // No-op wrapper — caller must handle debugger themselves
  return await fn()
}
