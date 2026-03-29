export default {
  site: "bilibili",
  name: "open",
  description: "打开B站视频页面（直接bvid或搜索后打开第N个结果）",
  columns: ["bvid", "title", "author", "url"],
  args: {
    bvid: { type: "string", default: "" },
    keyword: { type: "string", default: "" },
    index: { type: "int", default: 1 }
  },

  async run(page, args) {
    let bvid = args.bvid

    if (!bvid && args.keyword) {
      const results = await page.tap("bilibili", "search", { keyword: args.keyword })
      const idx = Math.max(0, (args.index || 1) - 1)
      if (!results || !results[idx]) {
        return [{ bvid: "", title: "", author: "", url: "no search results" }]
      }
      bvid = results[idx].bvid
    }

    if (!bvid) {
      return [{ bvid: "", title: "", author: "", url: "missing bvid or keyword arg" }]
    }

    await page.nav(`https://www.bilibili.com/video/${bvid}`)
    await page.waitFor(".video-info-title, .video-title, h1", 10000)
    await page.wait(2000)

    const info = await page.eval(() => {
      const bvMatch = location.pathname.match(/BV\w+/)
      const bv = bvMatch ? bvMatch[0] : ''
      const title = document.querySelector('.video-info-title .video-title, .video-title, h1')?.textContent?.trim() || ''
      const author = document.querySelector('.up-name, .username')?.textContent?.trim() || ''
      return { bvid: bv, title, author, url: location.href }
    })

    return [info]
  }
}
