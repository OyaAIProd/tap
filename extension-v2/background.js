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

import c_36kr_hot from './webclaws/36kr/hot.webclaw.js'
import c_baidu_hot from './webclaws/baidu/hot.webclaw.js'
import c_bilibili_comment from './webclaws/bilibili/comment.webclaw.js'
import c_bilibili_detail from './webclaws/bilibili/detail.webclaw.js'
import c_bilibili_hot from './webclaws/bilibili/hot.webclaw.js'
import c_bilibili_open from './webclaws/bilibili/open.webclaw.js'
import c_bilibili_search from './webclaws/bilibili/search.webclaw.js'
import c_bluesky_trending from './webclaws/bluesky/trending.webclaw.js'
import c_coingecko_top from './webclaws/coingecko/top.webclaw.js'
import c_crates_popular from './webclaws/crates/popular.webclaw.js'
import c_devto_top from './webclaws/devto/top.webclaw.js'
import c_dictionary_search from './webclaws/dictionary/search.webclaw.js'
import c_douban_hot from './webclaws/douban/hot.webclaw.js'
import c_douyin_comment from './webclaws/douyin/comment.webclaw.js'
import c_douyin_detail from './webclaws/douyin/detail.webclaw.js'
import c_douyin_hot from './webclaws/douyin/hot.webclaw.js'
import c_douyin_open from './webclaws/douyin/open.webclaw.js'
import c_douyin_search from './webclaws/douyin/search.webclaw.js'
import c_facebook_feed from './webclaws/facebook/feed.webclaw.js'
import c_github_trending from './webclaws/github/trending.webclaw.js'
import c_google_trends from './webclaws/google/trends.webclaw.js'
import c_hackernews_hot from './webclaws/hackernews/hot.webclaw.js'
import c_instagram_explore from './webclaws/instagram/explore.webclaw.js'
import c_jimeng_generate from './webclaws/jimeng/generate.webclaw.js'
import c_jimeng_history from './webclaws/jimeng/history.webclaw.js'
import c_jimeng_nav from './webclaws/jimeng/nav.webclaw.js'
import c_juejin_hot from './webclaws/juejin/hot.webclaw.js'
import c_lobsters_hot from './webclaws/lobsters/hot.webclaw.js'
import c_pixiv_ranking from './webclaws/pixiv/ranking.webclaw.js'
import c_producthunt_hot from './webclaws/producthunt/hot.webclaw.js'
import c_pypi_top from './webclaws/pypi/top.webclaw.js'
import c_reddit_hot from './webclaws/reddit/hot.webclaw.js'
import c_sspai_hot from './webclaws/sspai/hot.webclaw.js'
import c_stackoverflow_hot from './webclaws/stackoverflow/hot.webclaw.js'
import c_steam_top_sellers from './webclaws/steam/top-sellers.webclaw.js'
import c_telegraph_nav from './webclaws/telegraph/nav.webclaw.js'
import c_telegraph_publish from './webclaws/telegraph/publish.webclaw.js'
import c_tiktok_trending from './webclaws/tiktok/trending.webclaw.js'
import c_toutiao_hot from './webclaws/toutiao/hot.webclaw.js'
import c_v2ex_hot from './webclaws/v2ex/hot.webclaw.js'
import c_wechat_detail from './webclaws/wechat/detail.webclaw.js'
import c_wechat_open from './webclaws/wechat/open.webclaw.js'
import c_wechat_search from './webclaws/wechat/search.webclaw.js'
import c_weibo_comment from './webclaws/weibo/comment.webclaw.js'
import c_weibo_detail from './webclaws/weibo/detail.webclaw.js'
import c_weibo_hot from './webclaws/weibo/hot.webclaw.js'
import c_weibo_open from './webclaws/weibo/open.webclaw.js'
import c_weibo_search from './webclaws/weibo/search.webclaw.js'
import c_wikipedia_most_read from './webclaws/wikipedia/most-read.webclaw.js'
import c_x_trending from './webclaws/x/trending.webclaw.js'
import c_xiaohongshu_hot from './webclaws/xiaohongshu/hot.webclaw.js'
import c_xiaohongshu_post_detail from './webclaws/xiaohongshu/post_detail.webclaw.js'
import c_xiaohongshu_publish from './webclaws/xiaohongshu/publish.webclaw.js'
import c_xiaohongshu_search_fast from './webclaws/xiaohongshu/search_fast.webclaw.js'
import c_xiaohongshu_comment from './webclaws/xiaohongshu/comment.webclaw.js'
import c_xiaohongshu_detail from './webclaws/xiaohongshu/detail.webclaw.js'
import c_xiaohongshu_nav_publish from './webclaws/xiaohongshu/nav_publish.webclaw.js'
import c_xiaohongshu_open from './webclaws/xiaohongshu/open.webclaw.js'
import c_xiaohongshu_search from './webclaws/xiaohongshu/search.webclaw.js'
import c_xueqiu_hot_stock from './webclaws/xueqiu/hot-stock.webclaw.js'
import c_youtube_trending from './webclaws/youtube/trending.webclaw.js'
import c_zhihu_comment from './webclaws/zhihu/comment.webclaw.js'
import c_zhihu_detail from './webclaws/zhihu/detail.webclaw.js'
import c_zhihu_hot from './webclaws/zhihu/hot.webclaw.js'
import c_zhihu_open from './webclaws/zhihu/open.webclaw.js'
import c_zhihu_search from './webclaws/zhihu/search.webclaw.js'

const ALL_CLAWS = [
  c_36kr_hot, c_baidu_hot, c_bilibili_comment, c_bilibili_detail, c_bilibili_hot,
  c_bilibili_open, c_bilibili_search, c_bluesky_trending, c_coingecko_top,
  c_crates_popular, c_devto_top, c_dictionary_search, c_douban_hot, c_douyin_comment,
  c_douyin_detail, c_douyin_hot, c_douyin_open, c_douyin_search, c_facebook_feed, c_github_trending, c_google_trends, c_hackernews_hot,
  c_instagram_explore, c_jimeng_generate, c_jimeng_history, c_jimeng_nav, c_juejin_hot, c_lobsters_hot,
  c_pixiv_ranking, c_producthunt_hot, c_pypi_top, c_reddit_hot, c_sspai_hot,
  c_stackoverflow_hot, c_steam_top_sellers, c_telegraph_nav, c_telegraph_publish, c_tiktok_trending,
  c_toutiao_hot, c_v2ex_hot, c_wechat_detail, c_wechat_open, c_wechat_search,
  c_weibo_comment, c_weibo_detail, c_weibo_hot,
  c_weibo_open, c_weibo_search, c_wikipedia_most_read,
  c_x_trending, c_xiaohongshu_comment, c_xiaohongshu_detail, c_xiaohongshu_hot,
  c_xiaohongshu_nav_publish, c_xiaohongshu_open, c_xiaohongshu_post_detail, c_xiaohongshu_publish,
  c_xiaohongshu_search_fast, c_xiaohongshu_search,
  c_xueqiu_hot_stock, c_youtube_trending, c_zhihu_comment, c_zhihu_detail,
  c_zhihu_hot, c_zhihu_open, c_zhihu_search,
]

for (const mod of ALL_CLAWS) registerClaw(mod)
console.log(`[webclaw] registered ${ALL_CLAWS.length} claws`)

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
// Speaks the same protocol as the Rust CdpClient.send(method, params).
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
    console.log(`[webclaw] created new tab ${tab.id}`)
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
        console.log(`[webclaw] created tab ${tab.id} (was on chrome:// page)`)
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

function fmtFeedback(action, fb) {
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
      console.log(`[webclaw] attached to tab ${tabId}`)
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

// --- WebClaw Protocol Commands (via bridge WebSocket) ---

// Network log: per-tab, managed via networkLogs Map in State section

async function requireTab(params = {}) {
  const tabId = params.tabId ? Number(params.tabId) : activeTabId
  if (!tabId) throw new Error('No tab. Call Bridge.attach or pass tabId.')
  return tabId
}

async function handleClawCommand(method, params = {}) {
  switch (method) {
    // ---- Core ----

    case 'WebClaw.pageIntelligence': {
      const tabId = params.tabId || activeTabId
      if (!tabId) throw new Error('No tab. Call Bridge.attach first.')
      return await gatherPageIntelligence(tabId)
    }

    case 'WebClaw.run':
      return await handleClawAction({ action: 'run', ...params })

    case 'WebClaw.list':
      return await handleClawAction({ action: 'list' })

    case 'WebClaw.page_info': {
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

    // ---- Interaction tools (CDP native events) ----

    case 'WebClaw.click': {
      const tabId = await requireTab(params)
      const text = params.text
      if (!text) throw new Error('click: missing text param')
      const prevUrl = (await chrome.tabs.get(tabId)).url

      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (t) => {
          // Try CSS selector first
          let el = null
          try { el = document.querySelector(t) } catch {}
          // Fallback: find by visible text (leaf-first)
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
        args: [text],
        world: 'MAIN'
      })
      const pos = result?.result
      if (!pos) throw new Error(`click: "${text}" not found`)
      await cdpClick(tabId, pos.x, pos.y)
      await new Promise(r => setTimeout(r, 150))
      const fb = await pageFeedback(tabId)
      const nav = fb.url !== prevUrl ? ' (navigated)' : ''
      return fmtFeedback(`clicked "${text}" at (${Math.round(pos.x)}, ${Math.round(pos.y)})${nav}`, fb)
    }

    case 'WebClaw.click_selector': {
      const tabId = await requireTab(params)
      const selector = params.selector
      if (!selector) throw new Error('click_selector: missing selector param')
      const prevUrl = (await chrome.tabs.get(tabId)).url

      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel)
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
        args: [selector],
        world: 'MAIN'
      })
      const pos = result?.result
      if (!pos) throw new Error(`click_selector: "${selector}" not found`)
      await cdpClick(tabId, pos.x, pos.y)
      await new Promise(r => setTimeout(r, 150))
      const fb = await pageFeedback(tabId)
      const nav = fb.url !== prevUrl ? ' (navigated)' : ''
      return fmtFeedback(`clicked "${selector}" at (${Math.round(pos.x)}, ${Math.round(pos.y)})${nav}`, fb)
    }

    case 'WebClaw.type_text': {
      const tabId = await requireTab(params)
      const selector = params.selector
      const text = params.text
      if (!selector || text === undefined) throw new Error('type_text: missing selector or text')

      // Focus and clear via scripting
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (sel) => {
          const el = document.querySelector(sel)
          if (!el) return
          el.scrollIntoView({ block: 'center', behavior: 'instant' })
          el.focus()
          el.click()
          // Clear existing content
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

      // Type via CDP keyboard events
      await withDebugger(tabId, async (tid) => {
        // Delete selected content first
        await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
        })
        await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8
        })
        // Type each character
        for (const char of text) {
          await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchKeyEvent', {
            type: 'keyDown', text: char, key: char, code: `Key${char.toUpperCase()}`
          })
          await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchKeyEvent', {
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
          // For native inputs, set value via property descriptor to trigger Vue/React
          if ('value' in el) {
            const setter = Object.getOwnPropertyDescriptor(
              el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
              'value'
            )?.set
            if (setter) setter.call(el, val)
          }
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        },
        args: [selector, text],
        world: 'MAIN'
      })

      const val = await inputValue(tabId, selector)
      const fb = await pageFeedback(tabId)
      let msg = `typed ${text.length} chars into "${selector}"`
      if (val !== null) msg += `\n  → value: "${val}"`
      return fmtFeedback(msg, fb)
    }

    case 'WebClaw.hover': {
      const tabId = await requireTab(params)
      const selector = params.selector
      if (!selector) throw new Error('hover: missing selector')

      const [result] = await chrome.scripting.executeScript({
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
      const pos = result?.result
      if (!pos) throw new Error(`hover: "${selector}" not found`)

      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: pos.x, y: pos.y
        })
      })
      const fb = await pageFeedback(tabId)
      return fmtFeedback(`hovered "${selector}"`, fb)
    }

    case 'WebClaw.scroll': {
      const tabId = await requireTab(params)
      const selector = params.selector
      if (!selector) throw new Error('scroll: missing selector')

      const [result] = await chrome.scripting.executeScript({
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
      if (!result?.result) throw new Error(`scroll: "${selector}" not found`)
      const fb = await pageFeedback(tabId)
      return fmtFeedback(`scrolled to "${selector}"`, fb)
    }

    case 'WebClaw.press_key': {
      const tabId = await requireTab(params)
      const key = params.key
      if (!key) throw new Error('press_key: missing key')
      const modifiers = params.modifiers || 0
      const prevUrl = (await chrome.tabs.get(tabId)).url

      // Map key names to CDP key event params
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

      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchKeyEvent', {
          type: 'keyDown', modifiers, ...mapped
        })
        await chrome.debugger.sendCommand({ tabId: tid }, 'Input.dispatchKeyEvent', {
          type: 'keyUp', modifiers, ...mapped
        })
      })
      await new Promise(r => setTimeout(r, 150))
      const fb = await pageFeedback(tabId)
      const nav = fb.url !== prevUrl ? ' (navigated)' : ''
      return fmtFeedback(`pressed ${key}${nav}`, fb)
    }

    case 'WebClaw.select': {
      const tabId = await requireTab(params)
      const { selector, value } = params
      if (!selector || value === undefined) throw new Error('select: missing selector or value')

      const [result] = await chrome.scripting.executeScript({
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
      if (!result?.result) throw new Error(`select: "${selector}" not found`)
      const fb = await pageFeedback(tabId)
      return fmtFeedback(`selected "${value}" in "${selector}"`, fb)
    }

    case 'WebClaw.upload': {
      const tabId = await requireTab(params)
      const { selector, files } = params
      if (!selector || !files) throw new Error('upload: missing selector or files')
      const fileList = typeof files === 'string' ? files.split(',').map(f => f.trim()) : files

      await withDebugger(tabId, async (tid) => {
        const doc = await chrome.debugger.sendCommand({ tabId: tid }, 'DOM.getDocument', {})
        const node = await chrome.debugger.sendCommand({ tabId: tid }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId, selector
        })
        if (!node?.nodeId) throw new Error(`upload: "${selector}" not found`)
        await chrome.debugger.sendCommand({ tabId: tid }, 'DOM.setFileInputFiles', {
          nodeId: node.nodeId, files: fileList
        })
      })
      return `uploaded ${fileList.length} file(s) to "${selector}"`
    }

    // ---- Perception tools ----

    case 'WebClaw.find': {
      const tabId = await requireTab(params)
      const query = params.query
      const role = params.role || ''
      if (!query) throw new Error('find: missing query')

      const [result] = await chrome.scripting.executeScript({
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

          // Leaf-first: skip parent if a visible child also matches
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
        args: [query, role],
        world: 'MAIN'
      })
      return result?.result || []
    }

    case 'WebClaw.element_info': {
      const tabId = await requireTab(params)
      const selector = params.selector
      if (!selector) throw new Error('element_info: missing selector')

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

    case 'WebClaw.hit_test': {
      const tabId = await requireTab(params)
      const { x, y } = params
      if (x === undefined || y === undefined) throw new Error('hit_test: missing x or y')

      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (px, py) => {
          const el = document.elementFromPoint(px, py)
          if (!el) return null
          function quickSel(e) {
            if (e.id) return '#' + e.id
            const cls = Array.from(e.classList || []).filter(c => !/^(svelte-|css-|_|sc-)/.test(c)).slice(0, 2)
            if (cls.length) return `${e.tagName.toLowerCase()}.${cls.join('.')}`
            return e.tagName.toLowerCase()
          }
          return {
            tag: el.tagName.toLowerCase(), selector: quickSel(el),
            text: el.innerText?.trim().substring(0, 100) || '',
            role: el.getAttribute('role') || '',
            editable: el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
          }
        },
        args: [x, y],
        world: 'MAIN'
      })
      return result?.result || { error: `nothing at (${x}, ${y})` }
    }

    case 'WebClaw.top_layer': {
      const tabId = await requireTab(params)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const layers = []
          // Check open dialogs
          document.querySelectorAll('dialog[open]').forEach(d => {
            layers.push({ type: 'dialog', text: d.innerText?.trim().substring(0, 200) || '' })
          })
          // Check elements with high z-index that might be modals
          document.querySelectorAll('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="overlay"], [class*="popup"]').forEach(el => {
            if (el.offsetParent !== null || getComputedStyle(el).display !== 'none') {
              layers.push({ type: 'modal', cls: el.className?.toString().substring(0, 80), text: el.innerText?.trim().substring(0, 200) || '' })
            }
          })
          return layers
        },
        world: 'MAIN'
      })
      return result?.result || []
    }

    case 'WebClaw.ax_tree_interactive': {
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

    case 'WebClaw.read_dom': {
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

    case 'WebClaw.cookies': {
      const tabId = await requireTab(params)
      const tab = await chrome.tabs.get(tabId)
      const cookies = await chrome.cookies.getAll({ url: tab.url })
      return { cookies }
    }

    case 'WebClaw.set_cookie': {
      await requireTab(params)
      const { url, name, value, domain, path, secure, httpOnly, sameSite, expirationDate } = params
      if (!url || !name) throw new Error('set_cookie: missing url or name')
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

    case 'WebClaw.dismiss_dialog': {
      const tabId = await requireTab(params)
      const accept = params.accept !== false
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Page.handleJavaScriptDialog', {
          accept, promptText: params.prompt_text || ''
        })
      })
      return { dismissed: true, accepted: accept }
    }

    case 'WebClaw.force_state': {
      const tabId = await requireTab(params)
      const { selector, state } = params
      if (!selector || !state) throw new Error('force_state: missing selector or state')
      await withDebugger(tabId, async (tid) => {
        const doc = await chrome.debugger.sendCommand({ tabId: tid }, 'DOM.getDocument', {})
        const node = await chrome.debugger.sendCommand({ tabId: tid }, 'DOM.querySelector', {
          nodeId: doc.root.nodeId, selector
        })
        if (!node?.nodeId) throw new Error(`"${selector}" not found`)
        await chrome.debugger.sendCommand({ tabId: tid }, 'CSS.forcePseudoState', {
          nodeId: node.nodeId, forcedPseudoClasses: Array.isArray(state) ? state : [state]
        })
      })
      return { forced: true, selector, state }
    }

    case 'WebClaw.event_listeners': {
      const tabId = await requireTab(params)
      const selector = params.selector
      if (!selector) throw new Error('event_listeners: missing selector')
      let listeners = []
      await withDebugger(tabId, async (tid) => {
        const { result } = await chrome.debugger.sendCommand({ tabId: tid }, 'Runtime.evaluate', {
          expression: `document.querySelector(${JSON.stringify(selector)})`,
          returnByValue: false
        })
        if (result?.objectId) {
          const res = await chrome.debugger.sendCommand({ tabId: tid }, 'DOMDebugger.getEventListeners', {
            objectId: result.objectId
          })
          listeners = (res.listeners || []).map(l => ({ type: l.type, useCapture: l.useCapture, passive: l.passive, once: l.once }))
        }
      })
      return listeners
    }

    case 'WebClaw.storage_items': {
      const tabId = await requireTab(params)
      const storageType = params.type || 'local'
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: (t) => {
          const s = t === 'session' ? sessionStorage : localStorage
          const items = {}
          for (let i = 0; i < s.length; i++) {
            const key = s.key(i)
            items[key] = s.getItem(key)?.substring(0, 500)
          }
          return { type: t, count: s.length, items }
        },
        args: [storageType],
        world: 'MAIN'
      })
      return result?.result || {}
    }

    // ---- Network tools ----

    case 'WebClaw.network_log_start': {
      const tabId = await requireTab(params)
      const netLog = getNetworkLog(tabId)
      netLog.entries = []
      netLog.active = true
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Network.enable', {})
      })
      return { started: true }
    }

    case 'WebClaw.network_log_dump': {
      const tabId = await requireTab(params)
      const entries = getNetworkLog(tabId).entries.map(e => ({
        url: e.url, method: e.method, status: e.status,
        type: e.type, time: e.time
      }))
      return { count: entries.length, entries }
    }

    case 'WebClaw.network_log_dump_bodies': {
      const tabId = await requireTab(params)
      // Return entries with response bodies
      const entries = getNetworkLog(tabId).entries.slice(-50).map(e => ({
        url: e.url, method: e.method, status: e.status,
        type: e.type, responseBody: e.responseBody || null
      }))
      return { count: entries.length, entries }
    }

    case 'WebClaw.api_log': {
      const tabId = await requireTab(params)
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const log = window.__webclaw_api_log || []
          window.__webclaw_api_log = []
          return log
        },
        world: 'MAIN'
      })
      return result?.result || []
    }

    case 'WebClaw.download': {
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
      return { data: result?.result, output: output || '/tmp/webclaw-download' }
    }

    case 'WebClaw.save_image': {
      const tabId = await requireTab(params)
      const { selector, output } = params
      if (!selector || !output) throw new Error('save_image: missing selector or output')
      const [result] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async (sel) => {
          const img = document.querySelector(sel)
          if (!img || !img.src) return null
          const res = await fetch(img.src, { credentials: 'include' })
          const blob = await res.blob()
          const reader = new FileReader()
          return new Promise(resolve => {
            reader.onload = () => resolve(reader.result)
            reader.readAsDataURL(blob)
          })
        },
        args: [selector],
        world: 'MAIN'
      })
      return { data: result?.result, output }
    }

    // ---- Resource inspection ----

    case 'WebClaw.global_names': {
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

    case 'WebClaw.resource_tree': {
      const tabId = await requireTab(params)
      let tree = null
      await withDebugger(tabId, async (tid) => {
        tree = await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceTree', {})
      })
      return tree || {}
    }

    case 'WebClaw.resource_content': {
      const tabId = await requireTab(params)
      const { frameId, url } = params
      if (!url) throw new Error('resource_content: missing url')
      let content = null
      await withDebugger(tabId, async (tid) => {
        content = await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceContent', {
          frameId: frameId || (await chrome.debugger.sendCommand({ tabId: tid }, 'Page.getResourceTree', {}))?.frameTree?.frame?.id,
          url
        })
      })
      return content || {}
    }

    case 'WebClaw.search_resource': {
      const tabId = await requireTab(params)
      const { query } = params
      if (!query) throw new Error('search_resource: missing query')
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

    case 'WebClaw.request_replay': {
      const tabId = await requireTab(params)
      const { requestId } = params
      if (!requestId) throw new Error('request_replay: missing requestId')
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Network.replayXHR', { requestId })
      })
      return { replayed: true, requestId }
    }

    // ---- Intercept tools ----

    case 'WebClaw.intercept_on': {
      const tabId = await requireTab(params)
      const patterns = params.patterns || [{ urlPattern: '*' }]
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.enable', { patterns })
      })
      return { enabled: true, patterns }
    }

    case 'WebClaw.intercept_off': {
      const tabId = await requireTab(params)
      await withDebugger(tabId, async (tid) => {
        await chrome.debugger.sendCommand({ tabId: tid }, 'Fetch.disable', {})
      })
      return { disabled: true }
    }

    case 'WebClaw.intercept_list': {
      return { note: 'Intercept patterns are managed via intercept_on. No persistent list.' }
    }

    case 'WebClaw.intercept_continue': {
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

    case 'WebClaw.intercept_fulfill': {
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

    case 'WebClaw.intercept_fail': {
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

    case 'WebClaw.collect_toasts': {
      const tabId = params.tabId ? Number(params.tabId) : activeTabId
      if (!tabId) return []
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const toasts = window.__webclaw_toasts || []
            window.__webclaw_toasts = []
            return toasts
          },
          world: 'MAIN'
        })
        return result?.result || []
      } catch { return [] }
    }

    default:
      throw new Error(`Unknown WebClaw command: ${method}`)
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

      return await runClaw(site, name, args, tabId, { cdpClick, withDebugger })
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
    console.log(`[webclaw] debugger attached to ${tabId}`)
  }

  // Schedule auto-detach after 500ms idle
  const s = debuggerSessions.get(tabId)
  s.detachTimer = setTimeout(async () => {
    await chrome.debugger.detach({ tabId }).catch(() => {})
    debuggerSessions.delete(tabId)
    console.log(`[webclaw] debugger detached from ${tabId} (idle)`)
  }, 500)
}

async function withDebugger(tabId, fn) {
  await ensureDebugger(tabId)
  return await fn(tabId)
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

// --- Toast Observer: auto-inject on page load ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if ((tabId === activeTabId || debuggerSessions.has(tabId) || networkLogs.has(tabId)) && changeInfo.status === 'complete') {
    chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (window.__webclaw_toast_observer) return
        window.__webclaw_toasts = window.__webclaw_toasts || []

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
                  window.__webclaw_toasts.push({ text, time: Date.now(), cls: cls.substring(0, 100) })
                  if (window.__webclaw_toasts.length > 20) window.__webclaw_toasts.shift()
                }
              }
            }
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        window.__webclaw_toast_observer = observer
      },
      world: 'MAIN'
    }).catch(() => {}) // ignore chrome:// pages
  }
})

// --- Network Log Event Handler ---

chrome.debugger.onEvent.addListener((source, method, params) => {
  // Forward events for any managed tab
  wsSend({ method, params, tabId: source.tabId })

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
  if (alarm.name === 'keepalive' && (!ws || ws.readyState !== WebSocket.OPEN)) {
    connectBridge()
  }
})

console.log('[webclaw] v2 ready — webclaw:// protocol active')
