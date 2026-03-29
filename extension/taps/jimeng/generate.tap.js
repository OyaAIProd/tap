export default {
  site: "jimeng",
  name: "generate",
  description: "即梦AI 文生图 — 提交 prompt 触发生成（需先调用 jimeng/nav）",
  columns: ["status", "prompt"],
  args: {
    prompt: { type: "string" }
  },

  async run(page, args) {
    // Type prompt into the main input
    await page.type('[role="textbox"]', args.prompt)
    await page.wait(500)

    // Click the generate button via CDP native mouse event
    await page.click("立即生成")
    await page.wait(3000)

    // Verify generation started
    const status = await page.eval(() => {
      const loading = document.querySelector('[class*="loading"], [class*="progress"], [class*="generating"]')
      const result = document.querySelector('[class*="result"], [class*="image-item"], [class*="output"]')
      if (result) return 'generating'
      if (loading) return 'generating'
      return 'submitted'
    })

    return [{
      status,
      prompt: args.prompt.substring(0, 80)
    }]
  }
}
