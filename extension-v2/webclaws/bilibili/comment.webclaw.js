export default {
  site: "bilibili",
  name: "comment",
  description: "对当前已打开的B站视频发表评论",
  columns: ["status", "comment"],
  args: {
    comment: { type: "string" }
  },

  async run(page, args) {
    if (!args.comment) {
      return [{ status: "error", comment: "missing comment arg" }]
    }

    // Click comment textarea to focus
    await page.click(".reply-box-textarea, textarea")
    await page.wait(500)

    // Type comment
    await page.type(".reply-box-textarea, textarea", args.comment)
    await page.wait(500)

    // Click submit button
    await page.click(".reply-box-send")
    await page.wait(2000)

    return [{ status: "sent", comment: args.comment }]
  }
}
