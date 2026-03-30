export default {
  site: "discord",
  name: "send",
  description: "Send a message in the current Discord channel",
  columns: ["status", "message"],
  args: {
    message: { type: "string" }
  },

  async run(page, args) {
    if (!args.message) {
      return [{ status: "error", message: "missing message arg" }]
    }

    // Type into the message input
    await page.click('[role="textbox"]')
    await page.wait(300)
    await page.type('[role="textbox"]', args.message)
    await page.wait(300)

    // Send with Enter
    await page.pressKey("Enter")
    await page.wait(1000)

    return [{ status: "sent", message: args.message }]
  }
}
