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

    // JS click — CDP pointer causes detach on this page
    await page.eval(() => {
      const el = document.querySelector("#content-textarea")
      el?.focus()
      el?.click()
    })
    await page.wait(500)

    // Fill comment — execCommand for non-React textareas
    await page.eval((text) => {
      const el = document.querySelector("#content-textarea")
      el?.focus()
      document.execCommand('selectAll')
      document.execCommand('insertText', false, text)
    }, args.comment)
    await page.wait(300)

    // JS click submit — CDP pointer causes detach
    await page.eval(() => {
      const btn = document.querySelector("button.submit")
      btn?.click()
    })
    await page.wait(2000)

    return [{ status: "sent", comment: args.comment }]
  }
}
