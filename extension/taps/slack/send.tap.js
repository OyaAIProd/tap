export default {
  site: "slack",
  name: "send",
  description: "Send a message in the current Slack channel",
  columns: ["status", "message"],
  args: {
    message: { type: "string" }
  },

  async run(page, args) {
    if (!args.message) {
      return [{ status: "error", message: "missing message arg" }]
    }

    // Type into the message composer
    await page.click('[data-qa="message_input"], .ql-editor, [contenteditable="true"]')
    await page.wait(300)
    await page.type('[data-qa="message_input"], .ql-editor, [contenteditable="true"]', args.message)
    await page.wait(300)

    // Send with Enter
    await page.pressKey("Enter")
    await page.wait(1000)

    return [{ status: "sent", message: args.message }]
  }
}
