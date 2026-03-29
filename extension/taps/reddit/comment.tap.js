export default {
  site: "reddit",
  name: "comment",
  description: "Post a comment on Reddit (requires login)",
  columns: ["status", "url"],
  args: {
    post_url: { type: "string" },
    content: { type: "string" }
  },

  async run(page, args) {
    await page.nav(args.post_url)
    await page.wait(3000)

    // Click the comment box to focus it
    await page.click('[data-testid="comment-composer-button"], [placeholder*="Add a comment"], .public-DraftEditor-content, [contenteditable="true"]')
    await page.wait(1000)

    // Type the comment
    const editor = await page.find('[contenteditable="true"], .public-DraftEditor-content, [data-testid="comment-composer"] textarea')
    if (editor) {
      await page.click(editor)
      await page.wait(500)
    }
    await page.type('[contenteditable="true"]', args.content)
    await page.wait(1000)

    // Submit
    await page.click('[type="submit"], button:has-text("Comment"), [data-testid="comment-submit-button"]')
    await page.wait(3000)

    const url = await page.eval(() => location.href)
    return [{
      status: 'commented',
      url: String(url)
    }]
  }
}
