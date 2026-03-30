export default {
  site: "xiaohongshu",
  name: "my_notes",
  description: "读取自己发布的笔记列表及互动数据",
  columns: ["title", "views", "likes", "collects", "comments", "shares", "publish_date"],
  args: { limit: { type: "int", default: 20 } },
  health: { min_rows: 1, non_empty: ["title"] },

  async run(page, args) {
    await page.nav("https://creator.xiaohongshu.com/new/home")
    await page.waitFor('[class*="nav"], .menu, .sidebar, [class*="side"]', 8000)

    // JS click "笔记管理" — CDP pointer causes detach on creator pages
    await page.eval(() => {
      const el = Array.from(document.querySelectorAll('*'))
        .find(e => e.children.length === 0 && e.innerText?.trim() === '笔记管理')
      el?.click()
    })
    await page.waitFor('[class*="note-list"], [class*="noteList"], .note-item, [class*="content-list"]', 8000)

    // Extract note list from DOM
    const notes = await page.eval(() => {
      const text = document.body?.innerText || ""
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
      const results = []

      for (let i = 0; i < lines.length; i++) {
        // Match "发布于 YYYY年MM月DD日 HH:mm"
        if (/^发布于\s+\d{4}年/.test(lines[i])) {
          const publishDate = lines[i].replace("发布于 ", "")
          // Title is the line(s) before the date
          let title = ""
          for (let j = i - 1; j >= 0; j--) {
            if (/^\d+$/.test(lines[j]) || /^(权限|置顶|编辑|删除|已发布|审核|未通过|全部笔记)/.test(lines[j])) break
            title = lines[j] + (title ? " " + title : "")
            // Don't go back more than 3 lines
            if (i - j >= 3) break
          }
          // Stats are the 5 numbers after the date line
          const stats = []
          for (let j = i + 1; j < lines.length && stats.length < 5; j++) {
            if (/^\d+$/.test(lines[j])) stats.push(lines[j])
            else break
          }
          if (title) {
            results.push({
              title,
              views: stats[0] || "0",
              likes: stats[1] || "0",
              collects: stats[2] || "0",
              comments: stats[3] || "0",
              shares: stats[4] || "0",
              publish_date: publishDate
            })
          }
        }
      }
      return results
    })

    return notes.slice(0, args.limit)
  }
}
