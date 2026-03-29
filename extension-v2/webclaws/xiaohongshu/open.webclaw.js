export default {
  site: "xiaohongshu",
  name: "open",
  description: "搜索并打开第N条笔记的详情弹窗",
  columns: ["note_id", "title", "author", "url"],
  args: {
    keyword: { type: "string" },
    index: { type: "int", default: 1 }
  },

  async run(page, args) {
    await page.nav(`https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(args.keyword)}&type=51`)
    await page.waitFor("section.note-item", 10000)
    await page.wait(2000)

    await page.click(`section.note-item:nth-child(${args.index}) a.cover`)
    await page.wait(3000)

    // Extract basic info from SSR state
    const info = await page.eval(() => {
      const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {}
      for (const [k, v] of Object.entries(map)) {
        if (!k || k === "undefined" || k === "") continue
        const note = v?.note || {}
        return {
          note_id: k,
          title: note.title || note.displayTitle || "",
          author: (note.user || {}).nickname || "",
          url: location.href
        }
      }
      return null
    })

    if (!info) {
      return [{ note_id: "", title: "", author: "", url: "modal did not open" }]
    }
    return [info]
  }
}
