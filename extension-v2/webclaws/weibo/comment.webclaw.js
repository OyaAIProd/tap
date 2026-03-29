export default {
  site: "weibo",
  name: "comment",
  description: "对当前已打开的微博帖子发表评论",
  columns: ["status", "comment"],
  args: {
    comment: { type: "string" }
  },

  async run(page, args) {
    if (!args.comment) {
      return [{ status: "error", comment: "missing comment arg" }]
    }

    // Click comment input area to activate
    await page.click("textarea")
    await page.wait(500)

    // Type comment
    await page.type("textarea", args.comment)
    await page.wait(500)

    // Submit comment
    await page.click("button.m-send-btn")
    await page.wait(2000)

    return [{ status: "sent", comment: args.comment }]
  }
}
