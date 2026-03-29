/**
 * WebClaw v2 — Background Service Worker
 *
 * One extension, three interfaces:
 *   1. WebSocket bridge — Rust MCP server sends CDP commands + webclaw actions
 *   2. chrome.runtime.onMessage — popup UI
 *   3. chrome.runtime.onMessageExternal — web pages, other extensions
 *
 * Handles both CDP protocol (Page.navigate, Runtime.evaluate, Input.*)
 * and webclaw protocol (action: "list", action: "run").
 */

import { registerClaw, listClaws, runClaw, parseClawURL } from './runtime/executor.js'
import { gatherPageIntelligence } from './runtime/page-intelligence.js'

// --- WebClaw Registration (static imports — MV3 service workers prohibit dynamic import()) ---
// AUTO-GENERATED: run `node scripts/gen-imports.js` to regenerate

import c_36kr_hot from './webclaws/36kr/hot.claw.js'
import c_baidu_hot from './webclaws/baidu/hot.claw.js'
import c_bilibili_hot from './webclaws/bilibili/hot.claw.js'
import c_bluesky_trending from './webclaws/bluesky/trending.claw.js'
import c_coingecko_top from './webclaws/coingecko/top.claw.js'
import c_crates_popular from './webclaws/crates/popular.claw.js'
import c_devto_top from './webclaws/devto/top.claw.js'
import c_dictionary_search from './webclaws/dictionary/search.claw.js'
import c_douban_hot from './webclaws/douban/hot.claw.js'
import c_douyin_hot from './webclaws/douyin/hot.claw.js'
import c_douyin_search from './webclaws/douyin/search.claw.js'
import c_facebook_feed from './webclaws/facebook/feed.claw.js'
import c_github_trending from './webclaws/github/trending.claw.js'
import c_google_trends from './webclaws/google/trends.claw.js'
import c_hackernews_hot from './webclaws/hackernews/hot.claw.js'
import c_instagram_explore from './webclaws/instagram/explore.claw.js'
import c_jimeng_generate from './webclaws/jimeng/generate.claw.js'
import c_jimeng_history from './webclaws/jimeng/history.claw.js'
import c_juejin_hot from './webclaws/juejin/hot.claw.js'
import c_lobsters_hot from './webclaws/lobsters/hot.claw.js'
import c_pixiv_ranking from './webclaws/pixiv/ranking.claw.js'
import c_producthunt_hot from './webclaws/producthunt/hot.claw.js'
import c_pypi_top from './webclaws/pypi/top.claw.js'
import c_reddit_hot from './webclaws/reddit/hot.claw.js'
import c_sspai_hot from './webclaws/sspai/hot.claw.js'
import c_stackoverflow_hot from './webclaws/stackoverflow/hot.claw.js'
import c_steam_top_sellers from './webclaws/steam/top-sellers.claw.js'
import c_telegraph_publish from './webclaws/telegraph/publish.claw.js'
import c_tiktok_trending from './webclaws/tiktok/trending.claw.js'
import c_toutiao_hot from './webclaws/toutiao/hot.claw.js'
import c_v2ex_hot from './webclaws/v2ex/hot.claw.js'
import c_weibo_hot from './webclaws/weibo/hot.claw.js'
import c_weibo_search from './webclaws/weibo/search.claw.js'
import c_wikipedia_most_read from './webclaws/wikipedia/most-read.claw.js'
import c_x_trending from './webclaws/x/trending.claw.js'
import c_xiaohongshu_hot from './webclaws/xiaohongshu/hot.claw.js'
import c_xiaohongshu_post_detail from './webclaws/xiaohongshu/post_detail.claw.js'
import c_xiaohongshu_publish from './webclaws/xiaohongshu/publish.claw.js'
import c_xiaohongshu_search_api from './webclaws/xiaohongshu/search_api.claw.js'
import c_xiaohongshu_search_fast from './webclaws/xiaohongshu/search_fast.claw.js'
import c_xiaohongshu_search from './webclaws/xiaohongshu/search.claw.js'
import c_xueqiu_hot_stock from './webclaws/xueqiu/hot-stock.claw.js'
import c_youtube_trending from './webclaws/youtube/trending.claw.js'
import c_zhihu_hot from './webclaws/zhihu/hot.claw.js'
import c_zhihu_search from './webclaws/zhihu/search.claw.js'

const ALL_CLAWS = [
  c_36kr_hot, c_baidu_hot, c_bilibili_hot, c_bluesky_trending, c_coingecko_top,
  c_crates_popular, c_devto_top, c_dictionary_search, c_douban_hot, c_douyin_hot,
  c_douyin_search, c_facebook_feed, c_github_trending, c_google_trends, c_hackernews_hot,
  c_instagram_explore, c_jimeng_generate, c_jimeng_history, c_juejin_hot, c_lobsters_hot,
  c_pixiv_ranking, c_producthunt_hot, c_pypi_top, c_reddit_hot, c_sspai_hot,
  c_stackoverflow_hot, c_steam_top_sellers, c_telegraph_publish, c_tiktok_trending,
  c_toutiao_hot, c_v2ex_hot, c_weibo_hot, c_weibo_search, c_wikipedia_most_read,
  c_x_trending, c_xiaohongshu_hot, c_xiaohongshu_post_detail, c_xiaohongshu_publish,
  c_xiaohongshu_search_api, c_xiaohongshu_search_fast, c_xiaohongshu_search,
  c_xueqiu_hot_stock, c_youtube_trending, c_zhihu_hot, c_zhihu_search,
]

for (const mod of ALL_CLAWS) registerClaw(mod)
console.log(`[webclaw] registered ${ALL_CLAWS.length} claws`)

// --- State ---

let activeTabId = null

// --- CDP Command Router ---
// Speaks the same protocol as the Rust CdpClient.send(method, params).
// Scripting mode by default, debugger only for Input/DOM/Accessibility.

async function routeCDP(method, params = {}) {
  // Auto-recover: if no tab or tab is gone, create one
  if (activeTabId) {
    try { await chrome.tabs.get(activeTabId) }
    catch { activeTabId = null }
  }
  if (!activeTabId) {
    const tab = await chrome.tabs.create({ url: 'about:blank' })
    activeTabId = tab.id
    console.log(`[webclaw] created new tab ${tab.id}`)
  }

  switch (method) {
    // --- Scripting mode (undetectable) ---

    case 'Page.navigate': {
      // Can't navigate chrome:// tabs — create a new one
      const current = await chrome.tabs.get(activeTabId)
      if (current.url?.startsWith('chrome://')) {
        const tab = await chrome.tabs.create({ url: params.url })
        activeTabId = tab.id
        console.log(`[webclaw] created tab ${tab.id} (was on chrome:// page)`)
      } else {
        await chrome.tabs.update(activeTabId, { url: params.url })
      }
      await waitForTabLoad(activeTabId)
      return { frameId: 'main' }
    }

    case 'Runtime.evaluate': {
      // Use debugger for arbitrary expression eval — bypasses page CSP
      return await withDebugger(async () => {
        const result = await chrome.debugger.sendCommand(
          { tabId: activeTabId },
          'Runtime.evaluate',
          {
            expression: params.expression,
            returnByValue: true,
            awaitPromise: true,
          }
        )
        return result
      })
    }

    case 'Page.captureScreenshot': {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' })
      // Strip data URL prefix, return raw base64 like CDP does
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, '')
      return { data: base64 }
    }

    case 'Network.getCookies': {
      const tab = await chrome.tabs.get(activeTabId)
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
      return await withDebugger(async () => {
        return await chrome.debugger.sendCommand({ tabId: activeTabId }, method, params)
      })
  }
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
      console.log(`[webclaw] attached to tab ${tabId}`)
      return { tabId, attached: true, mode: 'scripting' }
    }

    case 'Bridge.detach': {
      activeTabId = null
      return { detached: true }
    }

    case 'Bridge.newTab': {
      const tab = await chrome.tabs.create({ url: params.url || 'about:blank' })
      return { tabId: tab.id, url: tab.url }
    }

    default:
      return { error: `Unknown bridge command: ${method}` }
  }
}

// --- WebClaw Protocol Commands (via bridge WebSocket) ---

async function handleClawCommand(method, params = {}) {
  switch (method) {
    case 'WebClaw.pageIntelligence': {
      const tabId = params.tabId || activeTabId
      if (!tabId) throw new Error('No tab. Call Bridge.attach first.')
      return await gatherPageIntelligence(tabId)
    }

    case 'WebClaw.run': {
      return await handleClawAction({ action: 'run', ...params })
    }

    case 'WebClaw.list': {
      return await handleClawAction({ action: 'list' })
    }

    case 'WebClaw.find': {
      const tabId = activeTabId
      if (!tabId) throw new Error('No tab. Call Bridge.attach first.')
      const query = params.query
      const role = params.role || ''
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (q, r) => {
          return Array.from(document.querySelectorAll('*'))
            .filter(el => el.textContent.includes(q) && el.offsetParent !== null && (!r || el.getAttribute('role') === r))
            .slice(0, 20)
            .map(el => ({ tag: el.tagName, text: el.textContent.trim().substring(0, 100), role: el.getAttribute('role') || '' }))
        },
        args: [query, role],
        world: 'MAIN'
      })
      return result?.result || []
    }

    case 'WebClaw.page_info': {
      const tabId = activeTabId
      if (!tabId) throw new Error('No tab. Call Bridge.attach first.')
      const tab = await chrome.tabs.get(tabId)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({ url: location.href, title: document.title, readyState: document.readyState }),
        world: 'MAIN'
      })
      return result?.result || { url: tab.url, title: tab.title }
    }

    default:
      throw new Error(`Unknown WebClaw command: ${method}`)
  }
}

// --- WebClaw Action Handler ---

async function handleClawAction(msg) {
  switch (msg.action) {
    case 'list':
      return { claws: listClaws() }

    case 'run': {
      let site, name, args
      if (msg.url) {
        ({ site, name, args } = parseClawURL(msg.url))
        args = { ...args, ...msg.args }
      } else {
        ({ site, name } = msg)
        args = msg.args || {}
      }

      let tabId = msg.tabId || activeTabId
      if (!tabId) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
        tabId = tab?.id
      }
      if (!tabId) throw new Error('no tab available')

      return await runClaw(site, name, args, tabId)
    }

    case 'showResults': {
      const hash = msg.url.replace('webclaw://', '')
      const resultsUrl = chrome.runtime.getURL(`results.html#${hash}`)
      chrome.tabs.create({ url: resultsUrl })
      return { ok: true }
    }

    case 'ping':
      return { pong: true, claws: listClaws().length }

    default:
      throw new Error(`unknown action: ${msg.action}`)
  }
}

// --- Unified Message Router ---
// Handles both CDP commands and webclaw actions from any source.

async function handleMessage(msg) {
  const { method, params, action } = msg

  // WebClaw actions: { action: "list" } or { action: "run", site, name }
  if (action) {
    return await handleClawAction(msg)
  }

  // Bridge meta-commands: { method: "Bridge.attach" }
  if (method && method.startsWith('Bridge.')) {
    return await handleBridgeCommand(method, params || {})
  }

  // WebClaw commands: { method: "WebClaw.pageIntelligence" }, { method: "WebClaw.run" }
  if (method && method.startsWith('WebClaw.')) {
    return await handleClawCommand(method, params || {})
  }

  // CDP commands: { method: "Page.navigate", params: { url: "..." } }
  if (method) {
    return await routeCDP(method, params || {})
  }

  throw new Error('invalid message: need "action" or "method"')
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

// --- WebSocket Bridge (for Rust MCP server) ---

const BRIDGE_PORT = 9333
let ws = null
let reconnectDelay = 1000

function connectBridge() {
  try {
    ws = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORT}`)
  } catch {
    scheduleBridgeReconnect()
    return
  }

  ws.onopen = () => {
    console.log('[webclaw] bridge connected')
    reconnectDelay = 1000
  }

  ws.onmessage = async (event) => {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }

    const { id } = msg
    try {
      const result = await handleMessage(msg)
      if (id !== undefined) wsSend({ id, result: result || {} })
    } catch (err) {
      if (id !== undefined) wsSend({ id, error: { code: -32000, message: err.message } })
    }
  }

  ws.onclose = () => {
    console.log('[webclaw] bridge disconnected')
    scheduleBridgeReconnect()
  }

  ws.onerror = () => scheduleBridgeReconnect()
}

function scheduleBridgeReconnect() {
  setTimeout(() => {
    reconnectDelay = Math.min(reconnectDelay * 2, 30000)
    connectBridge()
  }, reconnectDelay)
}

function wsSend(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg))
  }
}

// --- CDP Event Forwarding (when debugger is attached by withDebugger) ---

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source.tabId === activeTabId) {
    wsSend({ method, params })
  }
})

// --- Helpers ---

function waitForTabLoad(tabId) {
  return new Promise(resolve => {
    const onUpdated = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve() }, 30000)
  })
}

// Debugger with delayed detach — consecutive CDP commands share one session.
// Detaches automatically after 500ms of inactivity.
let debuggerTabId = null
let detachTimer = null

async function ensureDebugger() {
  if (detachTimer) { clearTimeout(detachTimer); detachTimer = null }
  if (debuggerTabId !== activeTabId) {
    if (debuggerTabId) await chrome.debugger.detach({ tabId: debuggerTabId }).catch(() => {})
    await chrome.debugger.attach({ tabId: activeTabId }, '1.3')
    await chrome.debugger.sendCommand({ tabId: activeTabId }, 'DOM.enable', {})
    await chrome.debugger.sendCommand({ tabId: activeTabId }, 'Page.enable', {})
    debuggerTabId = activeTabId
    console.log(`[webclaw] debugger attached to ${activeTabId}`)
  }
  // Schedule auto-detach after 500ms idle
  detachTimer = setTimeout(async () => {
    if (debuggerTabId) {
      await chrome.debugger.detach({ tabId: debuggerTabId }).catch(() => {})
      console.log(`[webclaw] debugger detached (idle)`)
      debuggerTabId = null
    }
  }, 500)
}

async function withDebugger(fn) {
  await ensureDebugger()
  return await fn()
}

// --- Omnibox: webclaw:// protocol via address bar ---

chrome.omnibox.onInputSuggestion = undefined // suppress default

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const claws = listClaws()
  const matches = text.trim()
    ? claws.filter(c => `${c.site}/${c.name}`.includes(text.trim()))
    : claws

  suggest(matches.slice(0, 8).map(c => ({
    content: `${c.site}/${c.name}`,
    description: `<match>${c.site}/${c.name}</match> — ${c.description || 'no description'}`
  })))
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

// --- Start ---

connectBridge()

chrome.alarms.create('keepalive', { periodInMinutes: 0.4 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive' && (!ws || ws.readyState !== WebSocket.OPEN)) {
    connectBridge()
  }
})

console.log('[webclaw] v2 ready — webclaw:// protocol active')
