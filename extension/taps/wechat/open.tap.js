export default {
  site: "wechat",
  name: "open",
  description: "搜索并打开微信公众号文章（通过关键词+序号或直接URL）",
  columns: ["title", "author", "url"],
  args: {
    keyword: { type: "string", default: "" },
    index: { type: "int", default: 1 },
    url: { type: "string", default: "" }
  },

  async run(page, args) {
    if (args.url) {
      await page.nav(args.url)
    } else if (args.keyword) {
      const results = await page.tap("wechat", "search", { keyword: args.keyword, limit: args.index || 5 })
      const target = results[(args.index || 1) - 1]
      if (!target || !target.url) {
        return [{ title: "", author: "", url: "no result at index " + (args.index || 1) }]
      }
      await page.nav(target.url)
    } else {
      return [{ title: "", author: "", url: "provide keyword or url" }]
    }

    await page.waitFor("#js_content, .rich_media_content", 10000)
    await page.wait(2000)

    const info = await page.eval(() => {
      const title = (document.querySelector('#activity-name')?.innerText || '').trim()
      const author = (document.querySelector('#js_name, .rich_media_meta_nickname')?.innerText || '').trim()
      return {
        title,
        author,
        url: location.href
      }
    })

    return [info]
  }
}
