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

import { registerTap, listTaps, runTap, parseTapURL } from './protocol/executor.js'
import { createPage } from './protocol/protocol.js'
import { gatherForgeInspection } from './protocol/forge.js'

// --- Tap Registration (static imports — MV3 service workers prohibit dynamic import()) ---
// AUTO-GENERATED: run `node scripts/gen-imports.js` to regenerate

import c_36kr_hot from './taps/36kr/hot.tap.js'
import c_baidu_hot from './taps/baidu/hot.tap.js'
import c_bilibili_comment from './taps/bilibili/comment.tap.js'
import c_bilibili_detail from './taps/bilibili/detail.tap.js'
import c_bilibili_hot from './taps/bilibili/hot.tap.js'
import c_bilibili_open from './taps/bilibili/open.tap.js'
import c_bilibili_search from './taps/bilibili/search.tap.js'
import c_bluesky_trending from './taps/bluesky/trending.tap.js'
import c_coingecko_top from './taps/coingecko/top.tap.js'
import c_crates_popular from './taps/crates/popular.tap.js'
import c_devto_top from './taps/devto/top.tap.js'
import c_dictionary_search from './taps/dictionary/search.tap.js'
import c_douban_hot from './taps/douban/hot.tap.js'
import c_douyin_comment from './taps/douyin/comment.tap.js'
import c_douyin_detail from './taps/douyin/detail.tap.js'
import c_douyin_hot from './taps/douyin/hot.tap.js'
import c_douyin_open from './taps/douyin/open.tap.js'
import c_douyin_search from './taps/douyin/search.tap.js'
import c_facebook_feed from './taps/facebook/feed.tap.js'
import c_github_issues from './taps/github/issues.tap.js'
import c_github_stars from './taps/github/stars.tap.js'
import c_github_trending from './taps/github/trending.tap.js'
import c_google_trends from './taps/google/trends.tap.js'
import c_hackernews_hot from './taps/hackernews/hot.tap.js'
import c_instagram_explore from './taps/instagram/explore.tap.js'
import c_jimeng_generate from './taps/jimeng/generate.tap.js'
import c_jimeng_history from './taps/jimeng/history.tap.js'
import c_jimeng_nav from './taps/jimeng/nav.tap.js'
import c_juejin_hot from './taps/juejin/hot.tap.js'
import c_lobsters_hot from './taps/lobsters/hot.tap.js'
import c_medium_hot from './taps/medium/hot.tap.js'
import c_medium_search from './taps/medium/search.tap.js'
import c_pixiv_ranking from './taps/pixiv/ranking.tap.js'
import c_producthunt_hot from './taps/producthunt/hot.tap.js'
import c_pypi_top from './taps/pypi/top.tap.js'
import c_arxiv_search from './taps/arxiv/search.tap.js'
import c_reddit_comment from './taps/reddit/comment.tap.js'
import c_reddit_hot from './taps/reddit/hot.tap.js'
import c_reddit_search from './taps/reddit/search.tap.js'
import c_sspai_hot from './taps/sspai/hot.tap.js'
import c_stackoverflow_hot from './taps/stackoverflow/hot.tap.js'
import c_steam_top_sellers from './taps/steam/top-sellers.tap.js'
import c_telegraph_nav from './taps/telegraph/nav.tap.js'
import c_telegraph_publish from './taps/telegraph/publish.tap.js'
import c_tiktok_trending from './taps/tiktok/trending.tap.js'
import c_toutiao_hot from './taps/toutiao/hot.tap.js'
import c_v2ex_hot from './taps/v2ex/hot.tap.js'
import c_wechat_detail from './taps/wechat/detail.tap.js'
import c_wechat_open from './taps/wechat/open.tap.js'
import c_wechat_search from './taps/wechat/search.tap.js'
import c_weibo_comment from './taps/weibo/comment.tap.js'
import c_weibo_detail from './taps/weibo/detail.tap.js'
import c_weibo_hot from './taps/weibo/hot.tap.js'
import c_weibo_open from './taps/weibo/open.tap.js'
import c_weibo_search from './taps/weibo/search.tap.js'
import c_weibo_to_xiaohongshu_auto_publish from './taps/weibo-to-xiaohongshu/auto_publish.tap.js'
import c_weread_highlights from './taps/weread/highlights.tap.js'
import c_weread_shelf from './taps/weread/shelf.tap.js'
import c_wikipedia_most_read from './taps/wikipedia/most-read.tap.js'
import c_x_post from './taps/x/post.tap.js'
import c_x_search from './taps/x/search.tap.js'
import c_x_trending from './taps/x/trending.tap.js'
import c_xiaohongshu_hot from './taps/xiaohongshu/hot.tap.js'
import c_xiaohongshu_post_detail from './taps/xiaohongshu/post_detail.tap.js'
import c_xiaohongshu_publish from './taps/xiaohongshu/publish.tap.js'
import c_xiaohongshu_search_fast from './taps/xiaohongshu/search_fast.tap.js'
import c_xiaohongshu_comment from './taps/xiaohongshu/comment.tap.js'
import c_xiaohongshu_detail from './taps/xiaohongshu/detail.tap.js'
import c_xiaohongshu_nav_publish from './taps/xiaohongshu/nav_publish.tap.js'
import c_xiaohongshu_open from './taps/xiaohongshu/open.tap.js'
import c_xiaohongshu_search from './taps/xiaohongshu/search.tap.js'
import c_xueqiu_hot_stock from './taps/xueqiu/hot-stock.tap.js'
import c_youtube_trending from './taps/youtube/trending.tap.js'
import c_zhihu_comment from './taps/zhihu/comment.tap.js'
import c_zhihu_detail from './taps/zhihu/detail.tap.js'
import c_zhihu_hot from './taps/zhihu/hot.tap.js'
import c_zhihu_open from './taps/zhihu/open.tap.js'
import c_zhihu_search from './taps/zhihu/search.tap.js'

const ALL_TAPS = [
  c_36kr_hot, c_baidu_hot, c_bilibili_comment, c_bilibili_detail, c_bilibili_hot,
  c_bilibili_open, c_bilibili_search, c_bluesky_trending, c_coingecko_top,
  c_crates_popular, c_devto_top, c_dictionary_search, c_douban_hot, c_douyin_comment,
  c_douyin_detail, c_douyin_hot, c_douyin_open, c_douyin_search, c_facebook_feed,
  c_github_issues, c_github_stars, c_github_trending, c_google_trends, c_hackernews_hot,
  c_instagram_explore, c_jimeng_generate, c_jimeng_history, c_jimeng_nav, c_juejin_hot, c_lobsters_hot,
  c_medium_hot, c_medium_search,
  c_pixiv_ranking, c_producthunt_hot, c_pypi_top,
  c_arxiv_search, c_reddit_comment, c_reddit_hot, c_reddit_search, c_sspai_hot,
  c_stackoverflow_hot, c_steam_top_sellers, c_telegraph_nav, c_telegraph_publish, c_tiktok_trending,
  c_toutiao_hot, c_v2ex_hot, c_wechat_detail, c_wechat_open, c_wechat_search,
  c_weibo_comment, c_weibo_detail, c_weibo_hot,
  c_weibo_open, c_weibo_search,
  c_weibo_to_xiaohongshu_auto_publish,
  c_weread_highlights, c_weread_shelf, c_wikipedia_most_read,
  c_x_post, c_x_search, c_x_trending, c_xiaohongshu_comment, c_xiaohongshu_detail, c_xiaohongshu_hot,
  c_xiaohongshu_nav_publish, c_xiaohongshu_open, c_xiaohongshu_post_detail, c_xiaohongshu_publish,
  c_xiaohongshu_search_fast, c_xiaohongshu_search,
  c_xueqiu_hot_stock, c_youtube_trending, c_zhihu_comment, c_zhihu_detail,
  c_zhihu_hot, c_zhihu_open, c_zhihu_search,
]

for (const mod of ALL_TAPS) registerTap(mod)
const sites = new Set(ALL_TAPS.map(t => t.site).filter(Boolean))
console.log(`[tap] ${ALL_TAPS.length} taps loaded (${sites.size} sites)`)

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
      // Try scripting mode first (no timeout, undetectable)
      // Falls back to debugger for pages with strict CSP
      const [evalResult] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (expr) => {
          try {
            const result = (0, eval)(expr)
            return { __ok: true, value: result }
          } catch (e) {
            return { __ok: false, error: e.message }
          }
        },
        args: [params.expression],
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
        { expression: params.expression, returnByValue: true, awaitPromise: true }
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
      return { tabId: tab.id, url: tab.url }
    }

    default:
      return { error: `Unknown bridge command: ${method}` }
  }
}

// --- Tap Protocol Commands (via bridge WebSocket) ---

// Network log: per-tab, managed via networkLogs Map in State section

async function requireTab(params = {}) {
  const tabId = params.tabId ? Number(params.tabId) : activeTabId
  if (!tabId) throw new Error('No tab. Call Bridge.attach or pass tabId.')
  return tabId
}

/** Create a page API instance for a tab. protocol.js is the single protocol implementation. */
function getPage(tabId) {
  return createPage(tabId, {
    cdpClick,
    withDebugger: (fn) => withDebugger(tabId, fn)
  })
}

async function handleTapCommand(method, params = {}) {
  switch (method) {
    // ---- Core ----

    case 'forge_inspect': {
      const tabId = params.tabId || activeTabId
      if (!tabId) throw new Error('No tab. Call Bridge.attach first.')
      return await gatherForgeInspection(tabId)
    }

    case 'run':
      return await handleTapAction({ action: 'run', ...params })

    case 'list':
      return await handleTapAction({ action: 'list' })

    case 'page': {
      const tabId = await requireTab(params)
      const tab = await chrome.tabs.get(tabId)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => ({
          url: location.href, title: document.title, readyState: document.readyState,
          viewport: { w: window.innerWidth, h: window.innerHeight },
          scroll: { x: window.scrollX, y: window.scrollY }
        }),
        world: 'MAIN'
      })
      return result?.result || { url: tab.url, title: tab.title }
    }

    // ---- Interaction tools — delegate to protocol.js (single protocol implementation) ----

    case 'click': {
      const tabId = await requireTab(params)
      const target = params.target || params.text || params.selector
      if (!target) throw new Error('click: missing target (text or selector)')
      const prevUrl = (await chrome.tabs.get(tabId)).url
      const page = getPage(tabId)
      await page.click(target)
      await new Promise(r => setTimeout(r, 150))
      const fb = await pageFeedback(tabId)
      const nav = fb.url !== prevUrl ? ' (navigated)' : ''
      return formatFeedback(`clicked "${target}"${nav}`, fb)
    }

    case 'type': {
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

    case 'hover': {
      const tabId = await requireTab(params)
      if (!params.selector) throw new Error('hover: missing selector')
      const page = getPage(tabId)
      await page.hover(params.selector)
      const fb = await pageFeedback(tabId)
      return formatFeedback(`hovered "${params.selector}"`, fb)
    }

    case 'scroll': {
      const tabId = await requireTab(params)
      if (!params.selector) throw new Error('scroll: missing selector')
      const page = getPage(tabId)
      await page.scroll(params.selector)
      const fb = await pageFeedback(tabId)
      return formatFeedback(`scrolled to "${params.selector}"`, fb)
    }

    case 'pressKey': {
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

    case 'select': {
      const tabId = await requireTab(params)
      const { selector, value } = params
      if (!selector || value === undefined) throw new Error('select: missing selector or value')
      const page = getPage(tabId)
      await page.select(selector, value)
      const fb = await pageFeedback(tabId)
      return formatFeedback(`selected "${value}" in "${selector}"`, fb)
    }

    case 'upload': {
      const tabId = await requireTab(params)
      const { selector, files } = params
      if (!selector || !files) throw new Error('upload: missing selector or files')
      const page = getPage(tabId)
      await page.upload(selector, files)
      const fileList = typeof files === 'string' ? files.split(',').map(f => f.trim()) : files
      return `uploaded ${fileList.length} file(s) to "${selector}"`
    }

    // ---- Perception tools — find delegates to protocol, rest are forge-only ----

    case 'find': {
      const tabId = await requireTab(params)
      if (!params.query) throw new Error('find: missing query')
      const page = getPage(tabId)
      return await page.find(params.query, params.role)
    }

    case 'element': {
      const tabId = await requireTab(params)
      const selector = params.selector
      if (!selector) throw new Error('element: missing selector')

      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
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
        },
        args: [selector],
        world: 'MAIN'
      })
      return result?.result || { error: `"${selector}" not found` }
    }

    case 'ax_tree_interactive': {
      const tabId = await requireTab(params)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const items = []
          const sels = 'a[href], button, input, textarea, select, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [contenteditable="true"], [tabindex]'
          document.querySelectorAll(sels).forEach(el => {
            if (el.offsetParent === null) return
            const rect = el.getBoundingClientRect()
            if (rect.width === 0 || rect.height === 0) return
            function qs(e) {
              if (e.id) return '#' + e.id
              const tid = e.getAttribute('data-testid')
              if (tid) return `[data-testid="${tid}"]`
              if (e.name) return `${e.tagName.toLowerCase()}[name="${e.name}"]`
              const cls = Array.from(e.classList || []).filter(c => !/^(svelte-|css-|_|sc-)/.test(c)).slice(0, 2)
              if (cls.length) return `${e.tagName.toLowerCase()}.${cls.join('.')}`
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
          return items
        },
        world: 'MAIN'
      })
      return { interactive: result?.result || [] }
    }

    case 'dom': {
      const tabId = await requireTab(params)
      const selector = params.selector || 'body'
      const maxDepth = params.depth || 6
      const summary = params.summary !== false

      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel, depth, doSummary) => {
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
        },
        args: [selector, maxDepth, summary],
        world: 'MAIN'
      })
      return result?.result || { error: `"${selector}" not found` }
    }

    // ---- State tools ----

    case 'cookies': {
      const tabId = await requireTab(params)
      const page = getPage(tabId)
      return { cookies: await page.cookies() }
    }

    case 'setCookie': {
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

    case 'dialog': {
      const tabId = await requireTab(params)
      const accept = params.accept !== false
      const page = getPage(tabId)
      await page.dialog(accept, params.prompt_text)
      return { dismissed: true, accepted: accept }
    }

    case 'storage': {
      const tabId = await requireTab(params)
      const type = params.type || 'local'
      const page = getPage(tabId)
      const items = await page.storage(type)
      return { type, count: Object.keys(items).length, items }
    }

    // ---- Network tools ----

    case 'networkStart': {
      const tabId = await requireTab(params)
      const netLog = getNetworkLog(tabId)
      netLog.entries = []
      netLog.active = true
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Network.enable', {})
      })
      return { started: true }
    }

    case 'networkDump': {
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

    case 'apiLog': {
      const tabId = await requireTab(params)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const log = window.__tap_api_log || []
          window.__tap_api_log = []
          return log
        },
        world: 'MAIN'
      })
      return result?.result || []
    }

    case 'download': {
      const tabId = await requireTab(params)
      const { url, output } = params
      if (!url) throw new Error('download: missing url')
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (u) => {
          const res = await fetch(u, { credentials: 'include' })
          const blob = await res.blob()
          const reader = new FileReader()
          return new Promise(resolve => {
            reader.onload = () => resolve(reader.result)
            reader.readAsDataURL(blob)
          })
        },
        args: [url],
        world: 'MAIN'
      })
      return { data: result?.result, output: output || '/tmp/tap-download' }
    }

    // ---- Resource inspection ----

    case 'globals': {
      const tabId = await requireTab(params)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const iframe = document.createElement('iframe')
          iframe.style.display = 'none'
          document.body.appendChild(iframe)
          const defaults = new Set(Object.getOwnPropertyNames(iframe.contentWindow))
          document.body.removeChild(iframe)
          const custom = Object.getOwnPropertyNames(window).filter(n => !defaults.has(n))
          return custom.slice(0, 200)
        },
        world: 'MAIN'
      })
      return result?.result || []
    }

    case 'resources': {
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

    case 'intercept_on': {
      const tabId = await requireTab(params)
      const patterns = params.patterns || [{ urlPattern: '*' }]
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.enable', { patterns })
      })
      return { enabled: true, patterns }
    }

    case 'intercept_off': {
      const tabId = await requireTab(params)
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.disable', {})
      })
      return { disabled: true }
    }

    case 'intercept_list': {
      return { note: 'Intercept patterns are managed via intercept_on. No persistent list.' }
    }

    case 'intercept_continue': {
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

    case 'intercept_fulfill': {
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

    case 'intercept_fail': {
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

    // ---- Toast collection ----

    case 'collect_toasts': {
      const tabId = params.tabId ? Number(params.tabId) : activeTabId
      if (!tabId) return []
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const toasts = window.__tap_toasts || []
            window.__tap_toasts = []
            return toasts
          },
          world: 'MAIN'
        })
        return result?.result || []
      } catch { return [] }
    }

    // --- Tab Management ---

    case 'tab_list': {
      const tabs = await chrome.tabs.query({})
      return tabs.map(t => ({ tabId: t.id, url: t.url || '', title: t.title || '' }))
    }

    case 'tab_new': {
      const tab = await chrome.tabs.create({ url: params.url || 'about:blank' })
      return { tabId: tab.id, url: tab.url || params.url || 'about:blank' }
    }

    case 'tab_close': {
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

    default:
      throw new Error(`Unknown Tap command: ${method}`)
  }
}

// --- CDP Click Helper ---
async function cdpClick(tabId, x, y) {
  await withDebugger(tabId, async (tid) => {
    const p = { x, y, button: 'left', clickCount: 1 }
    await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...p })
    await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...p })
  })
}

// --- Tap Action Handler ---

async function handleTapAction(msg) {
  switch (msg.action) {
    case 'list':
      return { taps: listTaps() }

    case 'run': {
      let site, name, args
      if (msg.url) {
        ({ site, name, args } = parseTapURL(msg.url))
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

      return await runTap(site, name, args, tabId, { cdpClick, withDebugger: (fn) => withDebugger(tabId, fn) })
    }

    case 'showResults': {
      const hash = msg.url.replace('tap://', '')
      const resultsUrl = chrome.runtime.getURL(`results.html#${hash}`)
      chrome.tabs.create({ url: resultsUrl })
      return { ok: true }
    }

    case 'ping':
      return { pong: true, taps: listTaps().length }

    default:
      throw new Error(`unknown action: ${msg.action}`)
  }
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
  if (msg.action) {
    return await handleTapAction(msg)
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
  return await fn(tabId)
}

// --- Omnibox: tap:// protocol via address bar ---

chrome.omnibox.onInputSuggestion = undefined // suppress default

chrome.omnibox.onInputChanged.addListener((text, suggest) => {
  const taps = listTaps()
  const matches = text.trim()
    ? taps.filter(c => `${c.site}/${c.name}`.includes(text.trim()))
    : taps

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

console.log(`[tap] v0.3.0 ready — ${ALL_TAPS.length} taps · ${sites.size} sites · tap:// active`)
