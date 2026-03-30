export default {
  site: "douyin",
  name: "reply",
  description: "回复抖音视频下的指定评论",
  columns: ["status", "comment"],
  args: {
    index: { type: "int", default: 1 },
    comment: { type: "string" }
  },

  async run(page, args) {
    if (!args.comment) {
      return [{ status: "error", comment: "missing comment arg" }]
    }

    // Click reply on the Nth comment
    const found = await page.eval((a) => {
      const items = document.querySelectorAll('[class*="commentItem"], [class*="comment-item"]')
      const idx = (a.index || 1) - 1
      const item = items[idx]
      if (!item) return false
      const replyBtn = item.querySelector('[class*="reply"], [class*="Reply"]')
      if (replyBtn) replyBtn.click()
      return !!replyBtn
    }, args)

    if (!found) {
      return [{ status: "error", comment: "comment not found at index " + args.index }]
    }

    await page.wait(1000)
    await page.type("textarea", args.comment)
    await page.wait(500)
    await page.click("发布")
    await page.wait(2000)

    return [{ status: "replied", comment: args.comment }]
  }
}
