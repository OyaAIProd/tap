export default {
  site: "zhihu",
  name: "comment",
  description: "对当前已打开的知乎回答发表评论",
  columns: ["status", "comment"],
  args: {
    comment: { type: "string" }
  },

  async run(page, args) {
    if (!args.comment) {
      return [{ status: "error", comment: "missing comment arg" }]
    }

    // Click the comment button to open comment panel
    await page.click("button.CommentButton")
    await page.wait(1000)

    // Click the comment input area (contenteditable)
    await page.click("[contenteditable]")
    await page.wait(500)

    // Type comment
    await page.type("[contenteditable]", args.comment)
    await page.wait(500)

    // Submit comment
    await page.click("button.CommentEditorV2-singleButton")
    await page.wait(2000)

    return [{ status: "sent", comment: args.comment }]
  }
}
