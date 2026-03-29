export default {
  site: "jimeng",
  name: "nav",
  description: "导航到即梦AI文生图页面",
  columns: ["status", "url"],
  args: {},

  async run(page) {
    await page.nav("https://jimeng.jianying.com/ai-tool/image/generate")
    await page.waitFor('[role="textbox"], .tiptap', 20000)
    await page.wait(1000)
    const url = await page.eval(() => location.href)
    return [{ status: "ready", url }]
  }
}
