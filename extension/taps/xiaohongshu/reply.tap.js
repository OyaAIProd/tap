export default {
  site: "xiaohongshu",
  name: "reply",
  description: "回复自己笔记下的评论",
  columns: ["status"],
  args: {
    note_id: { type: "string" },
    comment_index: { type: "int", default: 1 },
    text: { type: "string" }
  },

  async run(page, args) {
    if (!args.text) {
      return [{ status: "error: missing text arg" }]
    }

    // Find the Nth top-level comment and click its reply button
    const commentSel = `.comment-item:nth-child(${args.comment_index})`
    await page.waitFor(commentSel, 10000)

    // Click "回复" on the target comment to focus the reply input
    await page.click(`${commentSel} .reply-btn`)
    await page.wait(500)

    // Type the reply text into the active input
    await page.type("#content-textarea", args.text)
    await page.wait(500)

    // Submit the reply
    await page.click("button.submit")
    await page.wait(2000)

    return [{ status: "sent" }]
  }
}
