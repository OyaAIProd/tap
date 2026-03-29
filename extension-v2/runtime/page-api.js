/**
 * page API — the 17 system calls a .tap.js can use (Tap runtime).
 *
 * Scripting mode (undetectable): nav, wait, waitFor, eval, fetch, screenshot, cookies, scroll, select, download
 * Debugger mode (ms-level attach/detach): click, type, upload, hover, pressKey, dialog
 */

/**
 * Create a page API bound to a specific tab.
 * @param {number} tabId - Chrome tab ID
 * @param {object} opts - Options
 * @param {function} opts.cdpClick - CDP click function(tabId, x, y) from background.js
 * @param {function} opts.cdpType - CDP type function(tabId, selector, text) from background.js
 * @param {function} opts.withDebugger - Debugger wrapper from background.js
 * @returns {object} page API object
 */
export function createPageAPI(tabId, { cdpClick, cdpType, withDebugger } = {}) {
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
      // Find element coordinates via scripting (undetectable)
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: (t) => {
          // Try as CSS selector first
          let el = document.querySelector(t)
          // Fallback: find by visible text
          if (!el) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
            while (walker.nextNode()) {
              if (walker.currentNode.textContent?.trim() === t && walker.currentNode.offsetParent !== null) {
                el = walker.currentNode
                break
              }
            }
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

      // Use injected cdpClick from background.js (shares debugger state)
      if (cdpClick) {
        await cdpClick(tabId, pos.x, pos.y)
      } else {
        await _fallbackClick(tabId, pos.x, pos.y)
      }
    },

    /**
     * Type text into an element (by CSS selector).
     * Uses CDP native keyboard events.
     */
    async type(selector, text) {
      if (cdpType) {
        await cdpType(tabId, selector, text)
        return
      }
      // Focus the element via scripting
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel)
          if (el) { el.focus(); el.click() }
        },
        args: [selector],
        world: 'MAIN'
      })
      await new Promise(r => setTimeout(r, 100))

      // Type via debugger
      const wd = withDebugger || _fallbackWithDebugger
      await wd(async () => {
        for (const char of text) {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', text: char, key: char, code: `Key${char.toUpperCase()}`
          })
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type: 'keyUp', key: char, code: `Key${char.toUpperCase()}`
          })
        }
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
      return await chrome.cookies.getAll({ url: currentUrl })
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
