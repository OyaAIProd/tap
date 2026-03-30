export default {
  site: "weibo",
  name: "post",
  description: "发布微博帖子",
  columns: ["status", "url"],
  args: {
    content: { type: "string" }
  },

  async run(page, args) {
    if (!args.content) {
      return [{ status: "error", url: "missing content arg" }]
    }

    await page.nav("https://weibo.com")
    await page.wait(2000)

    // Click compose area
    await page.click("textarea[placeholder]")
    await page.wait(500)

    // Type content
    await page.type("textarea", args.content)
    await page.wait(500)

    // Click publish button
    await page.click('[node-type="submit"]')
    await page.wait(3000)

    const url = await page.eval(() => location.href)
    return [{ status: "posted", url }]
  }
}
