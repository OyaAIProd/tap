export default {
  site: "bilibili",
  name: "reply",
  description: "回复B站视频下的指定评论",
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
    const replyBtns = await page.eval((a) => {
      const btns = document.querySelectorAll(".reply-btn, .sub-reply-btn, [class*='reply']")
      const idx = (a.index || 1) - 1
      if (btns[idx]) {
        btns[idx].click()
        return true
      }
      return false
    }, args)

    if (!replyBtns) {
      return [{ status: "error", comment: "reply button not found at index " + args.index }]
    }

    await page.wait(1000)

    // Type reply
    await page.type("textarea", args.comment)
    await page.wait(500)

    // Submit
    await page.click("发布")
    await page.wait(2000)

    return [{ status: "replied", comment: args.comment }]
  }
}
