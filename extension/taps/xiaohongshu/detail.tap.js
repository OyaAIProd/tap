export default {
  site: "xiaohongshu",
  name: "detail",
  description: "读取当前已打开笔记的详情+评论（从SSR state提取）",
  columns: ["type", "content", "likes", "author"],
  args: {},
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page) {
    const items = await page.eval(() => {
      const results = []
      let noteMap
      try {
        noteMap = JSON.parse(JSON.stringify(
          window.__INITIAL_STATE__?.note?.noteDetailMap || {}
        ))
      } catch (e) {
        return [{ type: "error", content: "parse failed: " + e.message, likes: "0", author: "" }]
      }

      for (const [noteId, detail] of Object.entries(noteMap)) {
        const note = detail?.note || {}
        if (!note.title && !note.desc && !note.noteId) continue

        const interact = note.interactInfo || {}

        results.push({
          type: "note",
          content: (note.title || note.displayTitle || "") + "\n" + (note.desc || "").substring(0, 500),
          likes: String(interact.likedCount || 0),
          author: String((note.user || {}).nickname || "")
        })

        results.push({
          type: "engagement",
          content: "likes:" + (interact.likedCount || 0) + " comments:" + (interact.commentCount || 0) + " collects:" + (interact.collectedCount || 0),
          likes: String(interact.likedCount || 0),
          author: ""
        })

        const commentList = detail?.comments?.list || []
        for (const c of commentList) {
          const text = c.content || ""
          if (text.length < 2) continue
          results.push({
            type: "comment",
            content: text.substring(0, 300),
            likes: String(c.likeCount || 0),
            author: String((c.userInfo || {}).nickname || "")
          })

          for (const sc of (c.subComments || [])) {
            if ((sc.content || "").length < 2) continue
            results.push({
              type: "reply",
              content: sc.content.substring(0, 300),
              likes: String(sc.likeCount || 0),
              author: String((sc.userInfo || {}).nickname || "")
            })
          }
        }
      }

      if (results.length === 0) {
        results.push({ type: "info", content: "no note detail in state — call open first", likes: "0", author: "" })
      }
      return results
    })

    return items
  }
}
