export default {
  site: "xiaohongshu",
  name: "publish_text",
  description: "发布纯文字小红书笔记（无需图片）",
  columns: ["status", "url"],
  args: {
    title: { type: "string" },
    content: { type: "string" }
  },

  async run(page, args) {
    await page.type("input.d-text", args.title)
    await page.wait(500)

    await page.type(".tiptap.ProseMirror", args.content)
    await page.wait(500)

    await page.click("发布")
    await page.wait(5000)

    const url = await page.eval(() => location.href)
    return [{
      status: url.includes('/publish/publish') ? 'check-browser' : 'published',
      url
    }]
  }
}
