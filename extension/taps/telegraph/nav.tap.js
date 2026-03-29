export default {
  site: "telegraph",
  name: "nav",
  description: "导航到 Telegraph 编辑器并激活",
  columns: ["status", "url"],
  args: {},

  async run(page) {
    await page.nav("https://telegra.ph")
    await page.wait(2000)

    // Activate Quill editor
    await page.eval(() => { quill.enable(true) })
    await page.wait(500)

    const url = await page.eval(() => location.href)
    return [{ status: "ready", url }]
  }
}
