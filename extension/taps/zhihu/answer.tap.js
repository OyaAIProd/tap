export default {
  site: "zhihu",
  name: "answer",
  description: "在当前知乎问题页面写回答（需先打开问题页）",
  columns: ["status", "url"],
  args: {
    content: { type: "string" }
  },

  async run(page, args) {
    if (!args.content) {
      return [{ status: "error", url: "missing content arg" }]
    }

    // Click "写回答" button
    await page.click("写回答")
    await page.wait(1500)

    // Type into the rich text editor
    await page.click(".AnswerForm .RichText")
    await page.wait(500)
    await page.type(".AnswerForm .RichText", args.content)
    await page.wait(500)

    // Submit
    await page.click("提交回答")
    await page.wait(3000)

    const url = await page.eval(() => location.href)
    return [{ status: "submitted", url }]
  }
}
