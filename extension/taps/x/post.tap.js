export default {
  site: "x",
  name: "post",
  description: "Post a tweet on X/Twitter",
  columns: ["status", "url"],
  args: {
    content: { type: "string" }
  },

  async run(page, args) {
    await page.nav('https://x.com/compose/post')
    await page.wait(2000)

    // Type into the compose box
    await page.click('[data-testid="tweetTextarea_0"]')
    await page.wait(500)
    await page.type('[data-testid="tweetTextarea_0"]', args.content)
    await page.wait(1000)

    // Click the post button
    await page.click('[data-testid="tweetButton"]')
    await page.wait(3000)

    const url = await page.eval(() => location.href)
    const posted = !url.includes('/compose/')

    return [{
      status: posted ? 'posted' : 'check-browser',
      url: String(url)
    }]
  }
}
