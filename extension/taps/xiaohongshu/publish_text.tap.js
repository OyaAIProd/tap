export default {
  site: "xiaohongshu",
  name: "publish_text",
  description: "发布小红书文字笔记（自动生成白色封面图，正文限1000字）",
  columns: ["status", "url"],
  args: {
    title: { type: "string", default: "" },
    content: { type: "string" }
  },

  async run(page, args) {
    // XHS 图文 title limit: 20 chars, content limit: 1000 chars
    const title = (args.title || '').substring(0, 20)
    const content = (args.content || '').substring(0, 1000)

    // Generate a minimal white placeholder PNG (400x300) using Deno
    // Taps are Deno modules — Deno APIs are available at runtime
    const tmpImg = await Deno.makeTempFile({ suffix: '.png' })
    await (async () => {
      // Minimal PNG encoder: IHDR + IDAT (zlib-compressed scanlines) + IEND
      const w = 400, h = 300
      // Build raw scanlines: filter_byte(0x00) + RGB pixels (242,242,242 = light gray)
      const scanline = new Uint8Array(1 + w * 3)
      scanline[0] = 0  // filter: None
      for (let x = 0; x < w; x++) { scanline[1 + x * 3] = 242; scanline[2 + x * 3] = 242; scanline[3 + x * 3] = 242 }
      const raw = new Uint8Array(h * scanline.length)
      for (let y = 0; y < h; y++) raw.set(scanline, y * scanline.length)

      // zlib deflate using CompressionStream (available in Deno)
      const cs = new CompressionStream('deflate')
      const writer = cs.writable.getWriter()
      writer.write(raw); writer.close()
      const chunks = []
      for await (const chunk of cs.readable) chunks.push(chunk)
      const deflated = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0))
      let off = 0; for (const c of chunks) { deflated.set(c, off); off += c.length }

      // zlib header: CMF=0x78 FLG=0x9C (deflate, default compression)
      const zdata = new Uint8Array([0x78, 0x9C, ...deflated])

      function crc32(buf) {
        let c = 0xFFFFFFFF
        const t = new Uint32Array(256)
        for (let i = 0; i < 256; i++) { let v = i; for (let j = 0; j < 8; j++) v = (v & 1) ? 0xEDB88320 ^ (v >>> 1) : v >>> 1; t[i] = v }
        for (const b of buf) c = t[(c ^ b) & 0xFF] ^ (c >>> 8)
        return (c ^ 0xFFFFFFFF) >>> 0
      }
      function chunk(type, data) {
        const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, data.length)
        const body = new Uint8Array([...type, ...data])
        const crc = new Uint8Array(4); new DataView(crc.buffer).setUint32(0, crc32(body))
        return new Uint8Array([...len, ...body, ...crc])
      }
      const IHDR = chunk([73,72,68,82], (() => { const b = new Uint8Array(13); const v = new DataView(b.buffer); v.setUint32(0,w); v.setUint32(4,h); b[8]=8; b[9]=2; return b }()))
      const IDAT = chunk([73,68,65,84], zdata)
      const IEND = chunk([73,69,78,68], new Uint8Array(0))
      const sig = new Uint8Array([137,80,78,71,13,10,26,10])
      const png = new Uint8Array([...sig, ...IHDR, ...IDAT, ...IEND])
      await Deno.writeFile(tmpImg, png)
    })()

    try {
      await page.nav('https://creator.xiaohongshu.com/publish/publish')
      await page.waitFor('.creator-tab', 10000)

      // JS click "上传图文" (the visible tab, not the hidden one)
      await page.eval(() => {
        const tabs = Array.from(document.querySelectorAll('.creator-tab'))
          .filter(e => e.innerText?.trim() === '上传图文' && !e.style.left?.includes('-9999'))
        ;(tabs[0] || tabs[1])?.click()
      })
      await page.waitFor('input.upload-input', 5000)

      await page.upload('input.upload-input', tmpImg)

      try {
        await page.waitFor('[class*="cover"] img, [class*="preview"] img', 30000)
      } catch {
        return [{ status: 'upload-timeout', url: '' }]
      }

      await page.waitForNetwork(15000, 2000)

      // Fill content FIRST — editor steals focus; title must be set after
      if (content) {
        await page.eval((text) => {
          const editor = document.querySelector('.tiptap.ProseMirror')
          editor?.focus()
          document.execCommand('selectAll')
          document.execCommand('insertText', false, text)
        }, content)
        await page.wait(300)
      }

      // Fill title LAST — React native setter
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

      // Monitor toasts before clicking publish
      await page.eval(() => {
        window.__tapToast = []
        window.__tapToastObserver = new MutationObserver(ms => {
          for (const m of ms) for (const n of m.addedNodes)
            if (n.nodeType === 1 && n.innerText?.trim())
              window.__tapToast.push(n.innerText.trim().substring(0, 100))
        })
        window.__tapToastObserver.observe(document.body, { childList: true, subtree: true })
      })

      // JS click 发布
      await page.eval(() => {
        const btn = Array.from(document.querySelectorAll('button'))
          .find(e => e.innerText?.trim() === '发布')
        btn?.click()
      })

      // Poll for success URL or toast error (max 15s)
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
    } finally {
      await Deno.remove(tmpImg).catch(() => {})
    }
  }
}
