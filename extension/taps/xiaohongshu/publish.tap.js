export default {
  site: "xiaohongshu",
  name: "publish",
  description: "发布小红书图文笔记（需先调用 xiaohongshu/nav_publish）",
  columns: ["status", "url"],
  args: {
    title: { type: "string", default: "" },
    content: { type: "string", default: "" },
    images: { type: "string" }
  },

  async run(page, args) {
    await page.click("上传图文")
    await page.wait(2000)

    await page.upload("input.upload-input", args.images)

    // Wait for upload to complete
    const uploaded = await page.eval(() => {
      return new Promise((resolve) => {
        let attempts = 0
        const check = () => {
          const preview = document.querySelector('.upload-item img, .coverImg, [class*="cover"] img, [class*="preview"] img')
          if (preview || attempts > 60) {
            resolve(!!preview)
            return
          }
          attempts++
          setTimeout(check, 500)
        }
        check()
      })
    })

    if (!uploaded) {
      return [{ status: 'upload-timeout', url: '' }]
    }

    await page.wait(1000)

    if (args.title) {
      await page.type("input.d-text", args.title)
      await page.wait(500)
    }

    if (args.content) {
      await page.type(".tiptap.ProseMirror", args.content)
      await page.wait(500)
    }

    await page.click("发布")
    await page.wait(5000)

    const url = await page.eval(() => location.href)
    return [{
      status: url.includes('/publish/publish') ? 'check-browser' : 'published',
      url
    }]
  }
}
