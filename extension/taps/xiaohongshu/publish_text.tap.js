export default {
  site: "xiaohongshu",
  name: "publish_text",
  description: "发布纯文字小红书笔记（无需图片）",
  columns: ["status", "url"],
  args: {
    title: { type: "string", default: "" },
    content: { type: "string" }
  },

  async run(page, args) {
    // XHS title limit: 20 chars
    const title = (args.title || '').substring(0, 20)

    // Navigate to publish page — self-contained, no manual nav required
    await page.nav('https://creator.xiaohongshu.com/publish/publish')
    await page.waitFor('.creator-tab', 10000)

    // JS click "发文字笔记" tab — CDP pointer causes detach on this page
    await page.eval(() => {
      const el = Array.from(document.querySelectorAll('*'))
        .find(e => e.children.length === 0 &&
          (e.innerText?.trim() === '发文字笔记' || e.innerText?.trim() === '文字'))
      el?.click()
    })
    await page.waitFor('.tiptap.ProseMirror, textarea.d-text', 5000)

    // Fill content FIRST — editor.focus() steals focus; title must be set after
    if (args.content) {
      await page.eval((text) => {
        const editor = document.querySelector('.tiptap.ProseMirror')
        editor?.focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, text)
      }, args.content)
      await page.wait(300)
    }

    // Fill title LAST — React native setter; CDP page.type causes detach
    if (title) {
      await page.eval((t) => {
        const input = document.querySelector('input.d-text')
        input?.focus()
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        setter.call(input, t)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        input.dispatchEvent(new Event('change', { bubbles: true }))
      }, title)
      await page.wait(500)
    }

    // Monitor toasts before clicking publish to surface validation errors immediately
    await page.eval(() => {
      window.__tapToast = []
      window.__tapToastObserver = new MutationObserver(ms => {
        for (const m of ms) for (const n of m.addedNodes)
          if (n.nodeType === 1 && n.innerText?.trim())
            window.__tapToast.push(n.innerText.trim().substring(0, 100))
      })
      window.__tapToastObserver.observe(document.body, { childList: true, subtree: true })
    })

    // JS click "发布" — CDP pointer causes detach on this page
    await page.eval(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(e => e.innerText?.trim() === '发布')
      btn?.click()
    })

    // Wait for navigation to success page or toast error (max 15s)
    let published = false
    for (let i = 0; i < 30; i++) {
      await page.wait(500)
      const state = await page.eval(() => {
        const url = location.href
        const toast = (window.__tapToast || [])
          .find(t => t.includes('错误') || t.includes('失败') || t.includes('最多') || t.includes('请'))
        return { url, toast: toast || null }
      })
      if (state.toast) return [{ status: 'error: ' + state.toast, url: state.url }]
      if (state.url.includes('published=true') || state.url.includes('/publish/success')) {
        published = true
        break
      }
    }

    return [{ status: published ? 'published' : 'check-browser', url: await page.eval(() => location.href) }]
  }
}
