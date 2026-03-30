export default {
  site: "medium",
  name: "publish",
  description: "Publish an article on Medium",
  columns: ["status", "url"],
  args: {
    title: { type: "string" },
    content: { type: "string" }
  },

  async run(page, args) {
    if (!args.title || !args.content) {
      return [{ status: "error", url: "missing title or content" }]
    }

    await page.nav("https://medium.com/new-story")
    await page.wait(3000)

    // Type title
    await page.click('[data-testid="title"], h3[data-contents], [role="textbox"]')
    await page.wait(500)
    await page.type('[data-testid="title"], h3[data-contents], [role="textbox"]', args.title)
    await page.pressKey("Enter")
    await page.wait(500)

    // Type body content
    await page.type('[data-testid="body"], p[data-contents], .section-content', args.content)
    await page.wait(1000)

    // Click publish flow
    await page.click("Publish")
    await page.wait(2000)

    // Confirm publish in modal
    const confirmBtn = await page.eval(() => {
      const btns = Array.from(document.querySelectorAll("button"))
      const pub = btns.find(b => b.textContent?.includes("Publish"))
      if (pub) { pub.click(); return true }
      return false
    })

    await page.wait(3000)
    const url = await page.eval(() => location.href)

    return [{
      status: confirmBtn ? "published" : "check-browser",
      url
    }]
  }
}
