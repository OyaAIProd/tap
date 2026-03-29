export default {
  site: "xiaohongshu",
  name: "comment",
  description: "对当前已打开的笔记发表评论",
  columns: ["status", "comment"],
  args: {
    comment: { type: "string" }
  },

  async run(page, args) {
    if (!args.comment) {
      return [{ status: "error", comment: "missing comment arg" }]
    }

    // Click comment input to activate
    await page.click("#content-textarea")
    await page.wait(500)

    // Type comment
    await page.type("#content-textarea", args.comment)
    await page.wait(500)

    // Submit — use selector to avoid matching wrong "发送" text
    await page.click("button.submit")
    await page.wait(2000)

    return [{ status: "sent", comment: args.comment }]
  }
}
