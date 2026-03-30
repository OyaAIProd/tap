export default {
  site: "notion",
  name: "create",
  description: "Create a new page in Notion",
  columns: ["status", "url"],
  args: {
    title: { type: "string" },
    content: { type: "string", default: "" }
  },

  async run(page, args) {
    if (!args.title) {
      return [{ status: "error", url: "missing title arg" }]
    }

    await page.nav("https://www.notion.so")
    await page.wait(2000)

    // Create new page via keyboard shortcut
    await page.pressKey("n", 8) // Cmd+N (meta=8)
    await page.wait(2000)

    // Type title
    await page.type('[placeholder="Untitled"], .notion-title-input, [contenteditable]', args.title)
    await page.pressKey("Enter")
    await page.wait(500)

    // Type content if provided
    if (args.content) {
      await page.type('[data-content-editable-leaf], [placeholder="Type"], [contenteditable]', args.content)
      await page.wait(500)
    }

    await page.wait(1000)
    const url = await page.eval(() => location.href)

    return [{ status: "created", url }]
  }
}
