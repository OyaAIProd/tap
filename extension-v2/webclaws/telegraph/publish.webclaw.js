export default {
  site: "telegraph",
  name: "publish",
  description: "Telegraph 匿名发布文章（需先调用 telegraph/nav）",
  columns: ["status", "url"],
  args: {
    title: { type: "string", default: "Untitled" },
    author: { type: "string", default: "" },
    content: { type: "string", default: "" }
  },

  async run(page, args) {
    // Write title via Quill API
    await page.eval((title) => {
      quill.setText('\n')
      quill.insertText(0, title, { header: 1 })
    }, args.title)

    // Write author if provided
    if (args.author) {
      await page.eval((author) => {
        const addr = document.querySelector('.ql-editor address')
        const a = addr.querySelector('a') || document.createElement('a')
        a.textContent = author
        if (!addr.contains(a)) addr.appendChild(a)
        addr.classList.remove('empty')
      }, args.author)
    }

    // Write body content
    if (args.content) {
      await page.eval((content) => {
        quill.insertText(quill.getLength() - 1, content)
      }, args.content)
    }

    await page.wait(500)

    // Force publish button visible, then click
    await page.eval(() => {
      document.querySelector('#_publish_button').style.cssText =
        'visibility: visible !important; display: inline-block !important;'
    })
    await page.wait(300)
    await page.click("#_publish_button")
    await page.wait(3000)

    // Check result
    const url = await page.eval(() => location.href)
    const published = url !== 'https://telegra.ph/' && url.includes('telegra.ph/')

    return [{
      status: published ? 'published' : 'failed',
      url: String(url)
    }]
  }
}
