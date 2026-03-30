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

    // JS click "回复" — CDP pointer causes detach on this page
    await page.eval((sel) => {
      const comment = document.querySelector(sel)
      const replyBtn = comment?.querySelector('.reply-btn')
      replyBtn?.click()
    }, commentSel)
    await page.wait(500)

    // Fill reply — execCommand for non-React textareas
    await page.eval((text) => {
      const el = document.querySelector("#content-textarea")
      el?.focus()
      document.execCommand('selectAll')
      document.execCommand('insertText', false, text)
    }, args.text)
    await page.wait(300)

    // JS click submit — CDP pointer causes detach
    await page.eval(() => {
      const btn = document.querySelector("button.submit")
      btn?.click()
    })
    await page.wait(2000)

    return [{ status: "sent" }]
  }
}
