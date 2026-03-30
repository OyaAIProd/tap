/**
 * Tap v2 — Background Service Worker
 *
 * One extension, three interfaces:
 *   1. WebSocket bridge — Deno daemon relays CDP commands + tap actions
 *   2. chrome.runtime.onMessage — popup UI
 *   3. chrome.runtime.onMessageExternal — web pages, other extensions
 *
 * Handles both CDP protocol (Page.navigate, Runtime.evaluate, Input.*)
 * and tap protocol (action: "list", action: "run").
 */

import { createPage } from './protocol/protocol.js'
// executor.js removed — Deno executor is the only tap runner (extension = kernel only)

console.log('[tap] kernel ready (8 primitives + CDP relay)')

// --- State ---

let activeTabId = null  // default tab (backward compat — callers that don't pass tabId)

// Per-tab debugger sessions: tabId → { detachTimer }
const debuggerSessions = new Map()

// Per-tab network logs: tabId → { entries: [], active: boolean }
const networkLogs = new Map()

function getNetworkLog(tabId) {
  if (!networkLogs.has(tabId)) networkLogs.set(tabId, { entries: [], active: false })
  return networkLogs.get(tabId)
}

// Clean up when tabs close
chrome.tabs.onRemoved.addListener((tabId) => {
  const session = debuggerSessions.get(tabId)
  if (session?.detachTimer) clearTimeout(session.detachTimer)
  debuggerSessions.delete(tabId)
  networkLogs.delete(tabId)
  if (tabId === activeTabId) activeTabId = null
})

// --- CDP Command Router ---
// Speaks JSON-RPC: { id, method, params } → { id, result } or { id, error }.
// Scripting mode by default, debugger only for Input/DOM/Accessibility.

async function routeCDP(method, params = {}) {
  // Extract tabId from params, fall back to activeTabId
  let tabId = params.tabId ? Number(params.tabId) : activeTabId

  // Auto-recover: if no tab or tab is gone, create one
  if (tabId) {
    try { await chrome.tabs.get(tabId) }
    catch { tabId = null }
  }
  if (!tabId) {
    const tab = await chrome.tabs.create({ url: 'about:blank' })
    tabId = tab.id
    activeTabId = tab.id
    console.log(`[tap] created new tab ${tab.id}`)
  }

  switch (method) {
    // --- Scripting mode (undetectable) ---

    case 'Page.navigate': {
      // Can't navigate chrome:// tabs — create a new one
      const current = await chrome.tabs.get(tabId)
      if (current.url?.startsWith('chrome://')) {
        const tab = await chrome.tabs.create({ url: params.url })
        tabId = tab.id
        activeTabId = tab.id
        console.log(`[tap] created tab ${tab.id} (was on chrome:// page)`)
      } else {
        await chrome.tabs.update(tabId, { url: params.url })
      }
      await waitForTabLoad(tabId)
      return { frameId: 'main' }
    }

    case 'Runtime.evaluate': {
      // Wrap in block scope to prevent const/let redeclaration across calls
      const safeExpr = '{\n' + params.expression + '\n}'
      // Try scripting mode first (no timeout, undetectable)
      // Falls back to debugger for pages with strict CSP
      const [evalResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (expr) => {
          try {
            const result = await (0, eval)(expr)
            return { __ok: true, value: result }
          } catch (e) {
            return { __ok: false, error: e.message }
          }
        },
        args: [safeExpr],
        world: 'MAIN'
      })
      const wrapped = evalResult?.result
      if (wrapped?.__ok) {
        return { result: { type: typeof wrapped.value, value: wrapped.value } }
      }
      // CSP or eval error — fall back to debugger via ensureDebugger
      await ensureDebugger(tabId)
      return await chrome.debugger.sendCommand(
        { tabId }, 'Runtime.evaluate',
        { expression: safeExpr, returnByValue: true, awaitPromise: true }
      )
    }

    case 'Page.captureScreenshot': {
      const fmt = params.format || 'png'
      const quality = params.quality ?? (fmt === 'jpeg' ? 50 : undefined)
      const grayscale = params.grayscale === true

      // Inject grayscale CSS filter if requested
      if (grayscale) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => { document.documentElement.style.filter = 'grayscale(1)' },
            world: 'MAIN'
          })
          await new Promise(r => setTimeout(r, 50))
        } catch { /* ignore — some pages block scripting */ }
      }

      let result
      try {
        const opts = { format: fmt === 'jpeg' ? 'jpeg' : 'png' }
        if (fmt === 'jpeg' && quality !== undefined) opts.quality = quality
        const dataUrl = await chrome.tabs.captureVisibleTab(null, opts)
        const prefix = fmt === 'jpeg' ? /^data:image\/jpeg;base64,/ : /^data:image\/png;base64,/
        result = { data: dataUrl.replace(prefix, '') }
      } catch {
        // Fallback: use CDP debugger (works on GPU-rendered pages)
        const cdpOpts = { format: fmt === 'jpeg' ? 'jpeg' : 'png' }
        if (fmt === 'jpeg' && quality !== undefined) cdpOpts.quality = quality
        result = await withDebugger(tabId, async (tid) => {
          return await chrome.debugger.sendCommand(
            { tabId: tid }, 'Page.captureScreenshot', cdpOpts
          )
        })
      }

      // Remove grayscale filter
      if (grayscale) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            func: () => { document.documentElement.style.filter = '' },
            world: 'MAIN'
          })
        } catch { /* ignore */ }
      }

      return result
    }

    case 'Network.getCookies': {
      const tab = await chrome.tabs.get(tabId)
      const cookies = await chrome.cookies.getAll({ url: tab.url })
      return { cookies }
    }

    // --- No-ops (not needed in real browser) ---

    case 'Page.enable':
    case 'Network.enable':
    case 'Network.disable':
    case 'Network.setUserAgentOverride':
      return {}

    case 'Page.addScriptToEvaluateOnNewDocument':
      return { identifier: 'skipped' }

    // --- Debugger mode (ms-level attach/detach) ---

    default:
      return await withDebugger(tabId, async (tid) => {
        return await chrome.debugger.sendCommand({ tabId: tid }, method, params)
      })
  }
}

// --- Action Feedback Helpers ---

async function pageFeedback(tabId) {
  const tab = await chrome.tabs.get(tabId)
  return { url: tab.url, title: tab.title }
}

async function inputValue(tabId, selector) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (sel) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const v = el.value ?? el.textContent ?? ''
        return v.length > 200 ? v.slice(0, 200) + '…' : v
      },
      args: [selector],
      world: 'MAIN'
    })
    return r?.result ?? null
  } catch { return null }
}

function formatFeedback(action, fb) {
  return `${action}\n  → url: ${fb.url}\n  → title: ${fb.title}`
}

// --- Bridge Commands ---

async function handleBridgeCommand(method, params = {}) {
  switch (method) {
    case 'Bridge.ping':
      return { pong: true }

    case 'Bridge.getTargets': {
      const tabs = await chrome.tabs.query({})
      return tabs.map(t => ({
        id: String(t.id), type: 'page', title: t.title || '', url: t.url || '',
        webSocketDebuggerUrl: `bridge://tab/${t.id}`
      }))
    }

    case 'Bridge.attach': {
      const tabId = params.tabId
        ? Number(params.tabId)
        : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id

      if (!tabId) return { error: 'No tab to attach' }
      activeTabId = tabId
      console.log(`[tap] attached to tab ${tabId}`)
      return { tabId, attached: true, mode: 'scripting' }
    }

    case 'Bridge.detach': {
      const tabId = params.tabId ? Number(params.tabId) : activeTabId
      if (tabId === activeTabId) activeTabId = null
      const session = debuggerSessions.get(tabId)
      if (session) {
        if (session.detachTimer) clearTimeout(session.detachTimer)
        await chrome.debugger.detach({ tabId }).catch(() => {})
        debuggerSessions.delete(tabId)
      }
      networkLogs.delete(tabId)
      return { detached: true, tabId }
    }

    case 'Bridge.newTab': {
      const tab = await chrome.tabs.create({ url: params.url || 'about:blank' })
      activeTabId = tab.id
      return { tabId: tab.id, url: tab.url }
    }

    case 'Bridge.reload': {
      // Runtime-specific reload — Chrome Extension reloads itself
      console.log('[tap] reload requested via bridge')
      chrome.runtime.reload()
      return { reloaded: 'chrome-extension' }
    }

    default:
      return { error: `Unknown bridge command: ${method}` }
  }
}

// --- Tap Protocol Commands (via bridge WebSocket) ---

// Network log: per-tab, managed via networkLogs Map in State section

async function requireTab(params = {}) {
  let tabId = params.tabId ? Number(params.tabId) : activeTabId
  // Validate tab still exists
  if (tabId) {
    try { await chrome.tabs.get(tabId) }
    catch {
      // Tab gone — fall back to current active tab before creating a new one
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (active?.id) {
        tabId = active.id
        activeTabId = active.id
        console.log(`[tap] tab gone, fell back to active tab ${tabId}`)
      } else {
        tabId = null
      }
    }
  }
  if (!tabId) {
    const tab = await chrome.tabs.create({ url: 'about:blank' })
    tabId = tab.id
    activeTabId = tab.id
    console.log(`[tap] auto-created tab ${tab.id} (no active tab)`)
  }
  return tabId
}

/** Create a page API instance for a tab. protocol.js is the single protocol implementation. */
function getPage(tabId) {
  return createPage(tabId, {
    cdpClick,
    withDebugger: (fn) => withDebugger(tabId, fn),
    cdp: (method, params = {}) => withDebugger(tabId, () => chrome.debugger.sendCommand({ tabId }, method, params)),
  })
}

async function handleTapCommand(method, params = {}) {
  switch (method) {
    // ---- Kernel primitives — abstract names from page proxy ----

    case 'page.eval': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      // Wrap in block scope to prevent const/let redeclaration across calls
      const safeExpr = '{\n' + params.expression + '\n}'
      // Try chrome.scripting first (no debugger needed)
      const wrapped = await page.eval(async (expr) => {
        try {
          const result = await (0, eval)(expr)
          return { __ok: true, value: result }
        } catch (e) {
          return { __ok: false, error: String(e.message || e) }
        }
      }, safeExpr)
      if (wrapped?.__ok) return wrapped.value
      // CSP blocks eval() — fall back to CDP Runtime.evaluate (bypasses CSP)
      await ensureDebugger(tabId)
      const cdpResult = await chrome.debugger.sendCommand(
        { tabId }, 'Runtime.evaluate',
        { expression: safeExpr, returnByValue: true, awaitPromise: true }
      )
      if (cdpResult?.exceptionDetails) {
        throw new Error(cdpResult.exceptionDetails.exception?.description || 'eval failed')
      }
      return cdpResult?.result?.value
    }

    case 'page.pointer': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      await page.pointer(params.x, params.y, params.action || 'click')
      return {}
    }

    case 'page.keyboard': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      await page.keyboard(params.key, params.action || 'press', params.modifiers || 0)
      return {}
    }

    case 'page.nav': {
      let tabId = params.tabId ? Number(params.tabId) : activeTabId
      if (!tabId) {
        const tab = await chrome.tabs.create({ url: 'about:blank' })
        tabId = tab.id
        activeTabId = tab.id
      }
      const page = getPage(tabId)
      await page.nav(params.url)
      const tab = await chrome.tabs.get(tabId)
      return { tabId, url: tab.url, title: tab.title }
    }

    case 'page.wait': {
      const ms = params.ms || 1000
      await new Promise(r => setTimeout(r, ms))
      return {}
    }

    case 'page.waitFor': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      await page.waitFor(params.selector, params.ms || 10000)
      return {}
    }

    case 'page.waitForNetwork': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      await page.waitForNetwork(params.ms || 10000, params.idle || 500)
      return {}
    }

    case 'page.screenshot': {
      const tabId = await requireTab(params)
      const format = params.format || 'jpeg'
      const quality = params.quality ?? (format === 'jpeg' ? 50 : undefined)
      // Use CDP route which supports format + quality (kernel.screenshot is always PNG)
      return await routeCDP('Page.captureScreenshot', { tabId, format, quality })
    }

    // ---- Interaction tools — delegate to protocol.js (single protocol implementation) ----

    case 'page.click': {
      const tabId = await requireTab(params)
      const target = params.target || params.text || params.selector
      if (!target) throw new Error('click: missing target (text or selector)')
      const prevUrl = (await chrome.tabs.get(tabId)).url
      const page = getPage(tabId)
      await page.click(target)
      await new Promise(r => setTimeout(r, 150))
      const fb = await pageFeedback(tabId)
      const navigated = fb.url !== prevUrl
      return formatFeedback(`clicked "${target}"${navigated ? ' (navigated)' : ''}`, fb)
    }

    case 'page.type': {
      const tabId = await requireTab(params)
      if (!params.selector || params.text === undefined) throw new Error('type: missing selector or text')
      const page = getPage(tabId)
      await page.type(params.selector, params.text)
      const val = await inputValue(tabId, params.selector)
      const fb = await pageFeedback(tabId)
      let msg = `typed ${params.text.length} chars into "${params.selector}"`
      if (val !== null) msg += `\n  → value: "${val}"`
      return formatFeedback(msg, fb)
    }

    case 'page.fill': {
      const tabId = await requireTab(params)
      if (!params.selector || params.text === undefined) throw new Error('fill: missing selector or text')
      const page = getPage(tabId)
      await page.fill(params.selector, params.text)
      const val = await inputValue(tabId, params.selector)
      const fb = await pageFeedback(tabId)
      let msg = `filled "${params.selector}" with ${params.text.length} chars`
      if (val !== null) msg += `\n  → value: "${val}"`
      return formatFeedback(msg, fb)
    }

    case 'page.hover': {
      const tabId = await requireTab(params)
      if (!params.selector) throw new Error('hover: missing selector')
      const page = getPage(tabId)
      await page.hover(params.selector)
      const fb = await pageFeedback(tabId)
      return formatFeedback(`hovered "${params.selector}"`, fb)
    }

    case 'page.scroll': {
      const tabId = await requireTab(params)
      if (!params.selector) throw new Error('scroll: missing selector')
      const page = getPage(tabId)
      await page.scroll(params.selector)
      const fb = await pageFeedback(tabId)
      return formatFeedback(`scrolled to "${params.selector}"`, fb)
    }

    case 'page.pressKey': {
      const tabId = await requireTab(params)
      if (!params.key) throw new Error('pressKey: missing key')
      const prevUrl = (await chrome.tabs.get(tabId)).url
      const page = getPage(tabId)
      await page.pressKey(params.key, params.modifiers || 0)
      await new Promise(r => setTimeout(r, 150))
      const fb = await pageFeedback(tabId)
      const nav = fb.url !== prevUrl ? ' (navigated)' : ''
      return formatFeedback(`pressed ${params.key}${nav}`, fb)
    }

    case 'page.select': {
      const tabId = await requireTab(params)
      const { selector, value } = params
      if (!selector || value === undefined) throw new Error('select: missing selector or value')
      const page = getPage(tabId)
      await page.select(selector, value)
      const fb = await pageFeedback(tabId)
      return formatFeedback(`selected "${value}" in "${selector}"`, fb)
    }

    case 'page.upload': {
      const tabId = await requireTab(params)
      const { selector, files } = params
      if (!selector || !files) throw new Error('upload: missing selector or files')
      const page = getPage(tabId)
      await page.upload(selector, files)
      const fileList = typeof files === 'string' ? files.split(',').map(f => f.trim()) : files
      return `uploaded ${fileList.length} file(s) to "${selector}"`
    }

    // ---- Perception tools — find delegates to protocol, rest are forge-only ----

    case 'page.find': {
      const tabId = await requireTab(params)
      if (!params.query) throw new Error('find: missing query')
      const page = getPage(tabId)
      return await page.find(params.query, params.role)
    }

    // ---- State tools ----

    case 'page.cookies': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      return { cookies: await page.cookies() }
    }

    case 'page.setCookie': {
      await requireTab(params)
      const { url, name, value, domain, path, secure, httpOnly, sameSite, expirationDate } = params
      if (!url || !name) throw new Error('setCookie: missing url or name')
      const cookie = { url, name, value: value || '' }
      if (domain) cookie.domain = domain
      if (path) cookie.path = path
      if (secure !== undefined) cookie.secure = secure
      if (httpOnly !== undefined) cookie.httpOnly = httpOnly
      if (sameSite) cookie.sameSite = sameSite
      if (expirationDate) cookie.expirationDate = expirationDate
      await chrome.cookies.set(cookie)
      return { set: true, name }
    }

    case 'page.dialog': {
      const tabId = await requireTab(params)
      const accept = params.accept !== false
      const page = getPage(tabId)
      await page.dialog(accept, params.prompt_text)
      return { dismissed: true, accepted: accept }
    }

    case 'page.storage': {
      const tabId = await requireTab(params)
      const type = params.type || 'local'
      const page = getPage(tabId)
      const items = await page.storage(type)
      return { type, count: Object.keys(items).length, items }
    }

    // ---- Network tools ----

    case 'inspect.networkStart': {
      const tabId = await requireTab(params)
      const netLog = getNetworkLog(tabId)
      netLog.entries = []
      netLog.active = true
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Network.enable', {})
      })
      return { started: true }
    }

    case 'inspect.networkDump': {
      const tabId = await requireTab(params)
      if (params.bodies) {
        // Return entries with response bodies (was network_log_dump_bodies)
        const netLog = getNetworkLog(tabId)
        const filter = params.url_filter || ''
        let entries = netLog.entries.filter(e => e.responseBody && (!filter || e.url.includes(filter)))
        entries = entries.slice(-50).map(e => ({
          url: e.url, method: e.method, status: e.status,
          type: e.type, responseBody: e.responseBody || null
        }))
        return { count: entries.length, entries }
      }
      // Original: return entries without bodies
      const entries = getNetworkLog(tabId).entries.map(e => ({
        url: e.url, method: e.method, status: e.status,
        type: e.type, time: e.time
      }))
      return { count: entries.length, entries }
    }

    // ---- Resource inspection (CDP-based, stays in extension) ----

    case 'inspect.resources': {
      const tabId = await requireTab(params)
      if (params.url) {
        // Was resource_content
        const { frameId, url } = params
        let content = null
        await withDebugger(tabId, async (tid) => {
          content = await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceContent', {
            frameId: frameId || (await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceTree', {}))?.frameTree?.frame?.id,
            url
          })
        })
        return content || {}
      }
      if (params.query) {
        // Was search_resource
        let results = []
        await withDebugger(tabId, async (tid) => {
          const search = await chrome.debugger.sendCommand({ tabId: tid }, 'Page.searchInResource', {
            frameId: (await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceTree', {}))?.frameTree?.frame?.id,
            ...params
          })
          results = search?.result || []
        })
        return results
      }
      // Default: resource tree
      let tree = null
      await withDebugger(tabId, async (tid) => {
        tree = await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceTree', {})
      })
      return tree || {}
    }

    // ---- Intercept tools ----

    case 'intercept.on': {
      const tabId = await requireTab(params)
      const patterns = params.patterns || [{ urlPattern: '*' }]
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.enable', { patterns })
      })
      return { enabled: true, patterns }
    }

    case 'intercept.off': {
      const tabId = await requireTab(params)
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.disable', {})
      })
      return { disabled: true }
    }

    case 'intercept.list': {
      return { note: 'Intercept patterns are managed via intercept_on. No persistent list.' }
    }

    case 'intercept.continue': {
      const tabId = await requireTab(params)
      const { requestId, url, method, headers } = params
      if (!requestId) throw new Error('intercept_continue: missing requestId')
      await withDebugger(tabId, async (tid) => {
        const p = { requestId }
        if (url) p.url = url
        if (method) p.method = method
        if (headers) p.headers = headers
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.continueRequest', p)
      })
      return { continued: true }
    }

    case 'intercept.fulfill': {
      const tabId = await requireTab(params)
      const { requestId, responseCode, body, responseHeaders } = params
      if (!requestId) throw new Error('intercept_fulfill: missing requestId')
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.fulfillRequest', {
          requestId, responseCode: responseCode || 200,
          body: body ? btoa(body) : undefined,
          responseHeaders: responseHeaders || []
        })
      })
      return { fulfilled: true }
    }

    case 'intercept.fail': {
      const tabId = await requireTab(params)
      const { requestId, errorReason } = params
      if (!requestId) throw new Error('intercept_fail: missing requestId')
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.failRequest', {
          requestId, errorReason: errorReason || 'Failed'
        })
      })
      return { failed: true }
    }

    // --- Tab Management ---

    case 'tab.list': {
      const tabs = await chrome.tabs.query({})
      return tabs.map(t => ({ tabId: t.id, url: t.url || '', title: t.title || '' }))
    }

    case 'tab.new': {
      const tab = await chrome.tabs.create({ url: params.url || 'about:blank' })
      return { tabId: tab.id, url: tab.url || params.url || 'about:blank' }
    }

    case 'tab.close': {
      const tabId = Number(params.tabId)
      if (!tabId) throw new Error('tab_close: missing tabId')
      const session = debuggerSessions.get(tabId)
      if (session) {
        if (session.detachTimer) clearTimeout(session.detachTimer)
        await chrome.debugger.detach({ tabId }).catch(() => {})
        debuggerSessions.delete(tabId)
      }
      networkLogs.delete(tabId)
      if (tabId === activeTabId) activeTabId = null
      await chrome.tabs.remove(tabId)
      return { closed: true, tabId }
    }

    // --- Self-management ---

    case 'tap.reload': {
      // Reload the extension itself — applies code changes without manual chrome://extensions
      chrome.runtime.reload()
      return { reloaded: true }
    }

    case 'tap.version': {
      const manifest = chrome.runtime.getManifest()
      return { version: manifest.version, name: manifest.name }
    }

    // ---- Stdlib delegates (page object has these, just route through) ----

    case 'page.fetch': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      return await page.fetch(params.url, params.opts || {})
    }

    case 'page.download': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      return await page.download(params.url)
    }

    case 'page.ssrState': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      return await page.ssrState(params.name)
    }

    case 'page.capabilities': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      return page.capabilities()
    }

    default:
      throw new Error(`Unknown Tap command: ${method}`)
  }
}

// --- CDP Click Helper ---
async function cdpClick(tabId, x, y) {
  await withDebugger(tabId, async (tid) => {
    const p = { x, y, button: 'left', clickCount: 1 }
    // mouseMoved first — triggers mouseenter/mouseover (required for React synthetic events)
    await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...p })
    await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...p })
  })
}

// --- Unified Message Router ---
// Handles both CDP commands and tap actions from any source.

async function handleMessage(msg) {
  // --- Tap Protocol envelope: {"protocol":"tap/1.0","type":"...","method":"...","params":{...},"tabId":N} ---
  if (msg.protocol && msg.protocol.startsWith('tap/')) {
    const { type: msgType, method, params = {}, tabId } = msg
    if (tabId !== undefined && tabId >= 0) params.tabId = tabId

    switch (msgType) {
      case 'tool':   return await handleTapCommand(method, params)
      case 'cdp':    return await routeCDP(method, params, tabId >= 0 ? tabId : undefined)
      case 'bridge': return await handleBridgeCommand(`Bridge.${method}`, params)
      default: throw new Error(`unknown protocol type: ${msgType}`)
    }
  }

  // --- Internal messages (chrome.runtime: popup, omnibox, content-script) ---
  if (msg.action === 'ping') {
    return { pong: true }
  }
  if (msg.action === 'list') {
    return listTapsFromDisk()
  }
  if (msg.action === 'run') {
    let site, name, args
    if (msg.url) {
      const hash = msg.url.replace('tap://', '')
      const [path, queryString] = hash.split('?')
      ;[site, name] = path.split('/')
      args = {}
      if (queryString) {
        for (const pair of queryString.split('&')) {
          const eq = pair.indexOf('=')
          const k = eq === -1 ? pair : pair.slice(0, eq)
          const v = eq === -1 ? '' : pair.slice(eq + 1)
          args[decodeURIComponent(k)] = decodeURIComponent(v)
        }
      }
    } else if (msg.site && msg.name) {
      site = msg.site
      name = msg.name
      args = msg.args || {}
    }
    if (site && name) {
      if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
        return bridgeInvoke('run', { site, name, args })
      }
      return { error: 'daemon not running', hint: 'Run "tap daemon" in terminal, then try again' }
    }
  }
  if (msg.action === 'showResults') {
    const hash = msg.url.replace('tap://', '')
    chrome.tabs.create({ url: chrome.runtime.getURL(`results.html#${hash}`) })
    return { ok: true }
  }

  throw new Error('invalid message: need "protocol" or "action"')
}

// --- chrome.runtime listeners ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }))
  return true
})

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message }))
  return true
})

// --- WebSocket Bridge (for Deno daemon) ---

const BRIDGE_PORT = 9333
let bridgeSocket = null
let reconnectDelay = 1000

function connectBridge() {
  // Detach old socket to prevent stale close/error events triggering reconnect cascade
  if (bridgeSocket) {
    bridgeSocket.onclose = null
    bridgeSocket.onerror = null
    if (bridgeSocket.readyState <= WebSocket.OPEN) bridgeSocket.close()
  }

  let ws
  try {
    ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
  } catch {
    scheduleBridgeReconnect()
    return
  }
  bridgeSocket = ws

  ws.onopen = () => {
    console.log(`[tap] bridge connected (ws://127.0.0.1:${BRIDGE_PORT})`)
    reconnectDelay = 1000
    bridgeSend({ protocol: 'tap/1.0', id: 0, type: 'bridge', method: 'ping', params: {} })
  }

  ws.onmessage = async (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }

    const { id } = msg

    // Check if this is a response to our request
    if (id && pendingCallbacks.has(id)) {
      const pending = pendingCallbacks.get(id)
      pendingCallbacks.delete(id)
      clearTimeout(pending.timer)
      if (msg.error) {
        pending.reject(new Error(msg.error.message || msg.error))
      } else {
        pending.resolve(msg.result || msg)
      }
      return
    }

    // Otherwise, handle as a request from daemon
    try {
      const result = await handleMessage(msg)
      if (id !== undefined) bridgeSend({ id, result: result || {} })
    } catch (err) {
      if (id !== undefined) bridgeSend({ id, error: { code: -32000, message: err.message } })
    }
  }

  ws.onclose = () => {
    if (bridgeSocket === ws) {
      console.log('[tap] bridge disconnected')
      for (const [id, pending] of pendingCallbacks) {
        clearTimeout(pending.timer)
        pending.reject(new Error('bridge disconnected'))
      }
      pendingCallbacks.clear()
      scheduleBridgeReconnect()
    }
  }

  ws.onerror = () => {
    if (bridgeSocket === ws) scheduleBridgeReconnect()
  }
}

function scheduleBridgeReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 5000)
    connectBridge()
  }, reconnectDelay)
}

function bridgeSend(msg) {
  if (bridgeSocket && bridgeSocket.readyState === WebSocket.OPEN) {
    bridgeSocket.send(JSON.stringify(msg))
  }
}

const pendingCallbacks = new Map()
let nextBridgeId = 1

async function listTapsFromDisk() {
  try {
    const manifestUrl = chrome.runtime.getURL('taps/manifest.json')
    const response = await fetch(manifestUrl)
    const files = await response.json()
    const taps = files.map(f => {
      const [site, nameFile] = f.replace('.tap.js', '').split('/')
      return { site, name: nameFile }
    })
    return { taps, count: taps.length }
  } catch (e) {
    return { error: e.message, taps: [], count: 0 }
  }
}

function bridgeInvoke(method, params = {}, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN) {
      reject(new Error('daemon not connected — run "tap daemon" first'))
      return
    }

    const id = `ext_${nextBridgeId++}`
    const pending = { resolve, reject, timer: setTimeout(() => {
      pendingCallbacks.delete(id)
      reject(new Error(`bridge timeout after ${timeout}ms`))
    }, timeout) }
    pendingCallbacks.set(id, pending)

    bridgeSocket.send(JSON.stringify({
      protocol: 'tap/1.0',
      type: 'tool',
      method,
      params,
      id
    }))
  })
}

function waitForTabLoad(tabId, targetUrl) {
  return new Promise(resolve => {
    let done = false
    const finish = () => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpdated); resolve() } }
    const onUpdated = (id, changeInfo) => {
      if (id !== tabId) return
      if (changeInfo.status === 'complete') finish()
      if (targetUrl && changeInfo.url && changeInfo.url.startsWith(targetUrl.split('?')[0])) {
        setTimeout(finish, 500)
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    setTimeout(finish, 30000)
  })
}

// Per-tab debugger with delayed detach — consecutive CDP commands share one session.
// Detaches automatically after 500ms of inactivity per tab.

async function ensureDebugger(tabId) {
  const session = debuggerSessions.get(tabId)
  if (session?.detachTimer) { clearTimeout(session.detachTimer); session.detachTimer = null }

  if (!session?.attached) {
    // Attach to this tab
    await chrome.debugger.attach({ tabId }, '1.3')
    await chrome.debugger.sendCommand({ tabId }, 'DOM.enable', {})
    await chrome.debugger.sendCommand({ tabId }, 'Page.enable', {})
    debuggerSessions.set(tabId, { attached: true, detachTimer: null })
    console.log(`[tap] debugger attached to ${tabId}`)
  }

  // Schedule auto-detach after 500ms idle
  const s = debuggerSessions.get(tabId)
  s.detachTimer = setTimeout(async () => {
    await chrome.debugger.detach({ tabId }).catch(() => {})
    debuggerSessions.delete(tabId)
    console.log(`[tap] debugger detached from ${tabId} (idle)`)
  }, 500)
}

async function withDebugger(tabId, fn) {
  await ensureDebugger(tabId)
  try {
    return await fn(tabId)
  } catch (e) {
    // Debugger detached between ensure and fn — retry once
    if (String(e).includes('detached') || String(e).includes('not attached') || String(e).includes('Debugger')) {
      debuggerSessions.delete(tabId)
      await ensureDebugger(tabId)
      return await fn(tabId)
    }
    throw e
  }
}

// Clean up debugger sessions on unexpected detach
chrome.debugger.onDetach.addListener((source, reason) => {
  const session = debuggerSessions.get(source.tabId)
  if (session) {
    if (session.detachTimer) clearTimeout(session.detachTimer)
    debuggerSessions.delete(source.tabId)
    console.log(`[tap] debugger detached from ${source.tabId}: ${reason}`)
  }
})

// --- Omnibox: tap:// protocol via address bar ---

chrome.omnibox.onInputSuggestion = undefined // suppress default

chrome.omnibox.onInputChanged.addListener((_text, suggest) => {
  suggest([{ content: 'tap', description: 'Use <match>tap</match> CLI to run taps' }])
})

chrome.omnibox.onInputEntered.addListener((text, disposition) => {
  // text is "site/name?args" — open results page
  const resultsUrl = chrome.runtime.getURL(`results.html#${text.trim()}`)

  if (disposition === 'currentTab') {
    chrome.tabs.update({ url: resultsUrl })
  } else {
    chrome.tabs.create({ url: resultsUrl })
  }
})

// --- Toast Observer: auto-inject on page load ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if ((tabId === activeTabId || debuggerSessions.has(tabId) || networkLogs.has(tabId)) && changeInfo.status === 'complete') {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__tap_toast_observer) return
        window.__tap_toasts = window.__tap_toasts || []

        const observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType !== 1) continue
              const cls = (node.className || '').toString().toLowerCase()
              const role = node.getAttribute?.('role') || ''
              const ariaLive = node.getAttribute?.('aria-live') || ''
              const isToast =
                role === 'alert' || role === 'status' ||
                ariaLive === 'polite' || ariaLive === 'assertive' ||
                /toast|notification|snackbar|alert|message(?![-_])|notice|tip/.test(cls)
              if (isToast) {
                const text = node.innerText?.trim()
                if (text && text.length > 0 && text.length < 500) {
                  window.__tap_toasts.push({ text, time: Date.now(), cls: cls.substring(0, 100) })
                  if (window.__tap_toasts.length > 20) window.__tap_toasts.shift()
                }
              }
            }
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        window.__tap_toast_observer = observer
      },
      world: 'MAIN'
    }).catch(() => {}) // ignore chrome:// pages
  }
})

// --- Network Log Event Handler ---

chrome.debugger.onEvent.addListener((source, method, params) => {
  // Forward events for any managed tab
  bridgeSend({ method, params, tabId: source.tabId })

  const netLog = networkLogs.get(source.tabId)
  if (netLog?.active) {
    if (method === 'Network.requestWillBeSent') {
      netLog.entries.push({
        requestId: params.requestId,
        url: params.request?.url, method: params.request?.method,
        type: params.type, time: params.timestamp
      })
    } else if (method === 'Network.responseReceived') {
      const entry = netLog.entries.find(e => e.requestId === params.requestId)
      if (entry) { entry.status = params.response?.status }
    }
  }
})

// --- Start ---

connectBridge()

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && (!bridgeSocket || bridgeSocket.readyState !== WebSocket.OPEN)) {
    connectBridge()
  }
})

console.log(`[tap] v0.3.0 ready — tap:// active`)
