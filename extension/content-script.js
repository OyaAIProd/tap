/**
 * Tap Content Script — tap:// protocol support for every page.
 *
 * 1. window.tap("site/name", {args}) — programmatic API via CustomEvent bridge
 * 2. <a href="tap://site/name?args"> — clickable tap links
 *
 * Uses CustomEvent bridge instead of inline script injection to avoid CSP violations.
 */

// --- 1. window.tap() API via MAIN world script ---

// Inject API into page world via a file URL (avoids CSP inline script blocks)
const s = document.createElement('script')
s.src = chrome.runtime.getURL('tap-client.js')
s.onload = () => s.remove()
document.documentElement.appendChild(s)

// Bridge: page world sends CustomEvent → content script forwards to extension
window.addEventListener('tap-request', (e) => {
  const { id, action, site, name, args } = e.detail
  const msg = action === 'list' ? { action: 'list' } : { action: 'run', site, name, args }

  chrome.runtime.sendMessage(msg, (response) => {
    window.dispatchEvent(new CustomEvent('tap-response', {
      detail: {
        id,
        error: chrome.runtime.lastError?.message || response?.error || null,
        data: response
      }
    }))
  })
})

// --- 2. Intercept tap:// link clicks ---

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="tap://"]')
  if (!link) return

  e.preventDefault()
  const url = link.getAttribute('href')

  chrome.runtime.sendMessage({ action: 'run', url }, (response) => {
    if (response?.error) {
      console.error('[tap]', response.error)
    } else {
      chrome.runtime.sendMessage({ action: 'showResults', url, data: response })
    }
  })
}, true)
