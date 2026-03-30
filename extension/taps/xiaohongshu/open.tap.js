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

    // JS click — CDP pointer causes detach when navigating to note detail
    await page.eval((idx) => {
      const cover = document.querySelector(`section.note-item:nth-child(${idx}) a.cover`)
      cover?.click()
    }, args.index)

    // Poll SSR state for note details — more reliable than fixed wait
    let info = null
    for (let i = 0; i < 20; i++) {
      await page.wait(500)
      info = await page.eval(() => {
        const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {}
        for (const [k, v] of Object.entries(map)) {
          if (!k || k === "undefined" || k === "") continue
          const note = v?.note || {}
          if (!note.noteId && !note.title) continue
          return {
            note_id: k,
            title: note.title || note.displayTitle || "",
            author: (note.user || {}).nickname || "",
            url: location.href
          }
        }
        return null
      })
      if (info) break
    }

    if (!info) {
      return [{ note_id: "", title: "", author: "", url: "modal did not open" }]
    }
    return [info]
  }
}
