/**
 * WebClaw page-world API — injected via <script src="..."> to avoid CSP.
 * Communicates with content script via CustomEvent bridge.
 */
(function() {
  let reqId = 0
  const pending = new Map()

  window.addEventListener('webclaw-response', (e) => {
    const { id, error, data } = e.detail
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    if (error) p.reject(new Error('webclaw: ' + error))
    else p.resolve(data)
  })

  function request(detail) {
    return new Promise((resolve, reject) => {
      const id = ++reqId
      pending.set(id, { resolve, reject })
      window.dispatchEvent(new CustomEvent('webclaw-request', { detail: { id, ...detail } }))
    })
  }

  window.webclaw = function(path, args = {}) {
    const [site, name] = path.split('/')
    if (!site || !name) return Promise.reject(new Error('webclaw: usage: webclaw("site/name", {args})'))
    return request({ action: 'run', site, name, args })
  }

  window.webclaw.list = function() {
    return request({ action: 'list' })
  }

  window.webclaw.version = '2.0.0'
  console.log('[webclaw] protocol ready — try: webclaw("github/trending", {limit: 5})')
})()
