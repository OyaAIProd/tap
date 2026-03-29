/**
 * WebClaw Content Script — webclaw:// protocol support for every page.
 *
 * 1. window.webclaw("site/name", {args}) — programmatic API via CustomEvent bridge
 * 2. <a href="webclaw://site/name?args"> — clickable webclaw links
 *
 * Uses CustomEvent bridge instead of inline script injection to avoid CSP violations.
 */

// --- 1. window.webclaw() API via MAIN world script ---

// Inject API into page world via a file URL (avoids CSP inline script blocks)
const s = document.createElement('script')
s.src = chrome.runtime.getURL('webclaw-page-api.js')
s.onload = () => s.remove()
document.documentElement.appendChild(s)

// Bridge: page world sends CustomEvent → content script forwards to extension
window.addEventListener('webclaw-request', (e) => {
  const { id, action, site, name, args } = e.detail
  const msg = action === 'list' ? { action: 'list' } : { action: 'run', site, name, args }

  chrome.runtime.sendMessage(msg, (response) => {
    window.dispatchEvent(new CustomEvent('webclaw-response', {
      detail: {
        id,
        error: chrome.runtime.lastError?.message || response?.error || null,
        data: response
      }
    }))
  })
})

// --- 2. Intercept webclaw:// link clicks ---

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[href^="webclaw://"]')
  if (!link) return

  e.preventDefault()
  const url = link.getAttribute('href')

  chrome.runtime.sendMessage({ action: 'run', url }, (response) => {
    if (response?.error) {
      console.error('[webclaw]', response.error)
    } else {
      chrome.runtime.sendMessage({ action: 'showResults', url, data: response })
    }
  })
}, true)
