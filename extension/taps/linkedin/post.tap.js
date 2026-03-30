export default {
  site: "linkedin",
  name: "post",
  description: "Post to LinkedIn feed",
  columns: ["status", "url"],
  args: {
    content: { type: "string" }
  },

  async run(page, args) {
    if (!args.content) {
      return [{ status: "error", url: "missing content arg" }]
    }

    await page.nav("https://www.linkedin.com/feed/")
    await page.wait(2000)

    // Click "Start a post" button
    await page.click("Start a post")
    await page.wait(2000)

    // Type into the post editor
    await page.type('[role="textbox"], .ql-editor, [contenteditable="true"]', args.content)
    await page.wait(1000)

    // Click Post button
    await page.click("Post")
    await page.wait(3000)

    const url = await page.eval(() => location.href)
    return [{ status: "posted", url }]
  }
}
