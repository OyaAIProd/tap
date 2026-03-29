export default {
  site: "zhihu",
  name: "detail",
  description: "读取当前已打开知乎问题的详情+回答+评论（API优先）",
  columns: ["type", "content", "likes", "author"],
  args: {},
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page) {
    const items = await page.eval(async () => {
      const results = []
      const url = location.href

      // Extract question id from URL
      const qidMatch = url.match(/question\/(\d+)/)
      if (!qidMatch) {
        return [{ type: "error", content: "not on a zhihu question page — call open first", likes: "0", author: "" }]
      }
      const qid = qidMatch[1]

      // Try SSR state first for question data
      try {
        const state = window.__INITIAL_STATE__
        const question = state?.entities?.questions?.[qid] || state?.question || {}
        const title = question.title || ""
        const detail = (question.detail || "").replace(/<[^>]+>/g, "").trim()

        if (title) {
          results.push({
            type: "question",
            content: title + (detail ? "\n" + detail.substring(0, 500) : ""),
            likes: String(question.followerCount || question.visitCount || 0),
            author: ""
          })
        }
      } catch (e) {
        // SSR state not available, continue with API
      }

      // Fetch top answers via API
      try {
        const answersRes = await fetch(
          "https://www.zhihu.com/api/v4/questions/" + qid + "/answers?limit=5&offset=0&include=data%5B*%5D.content,voteup_count,comment_count,author",
          { credentials: "include" }
        )
        const answersData = await answersRes.json()
        const answers = answersData.data || []

        for (const a of answers) {
          const text = (a.content || "").replace(/<[^>]+>/g, "").trim()
          results.push({
            type: "answer",
            content: text.substring(0, 500),
            likes: String(a.voteup_count || 0),
            author: String(a.author?.name || "")
          })

          // Fetch comments for top answer (first one only to avoid rate limits)
          if (answers.indexOf(a) === 0 && a.id) {
            try {
              const commentsRes = await fetch(
                "https://www.zhihu.com/api/v4/answers/" + a.id + "/root_comments?limit=10&offset=0",
                { credentials: "include" }
              )
              const commentsData = await commentsRes.json()
              const comments = commentsData.data || []

              for (const c of comments) {
                const cText = (c.content || "").replace(/<[^>]+>/g, "").trim()
                if (cText.length < 2) continue
                results.push({
                  type: "comment",
                  content: cText.substring(0, 300),
                  likes: String(c.vote_count || c.like_count || 0),
                  author: String(c.author?.name || c.author?.member?.name || "")
                })
              }
            } catch (e) {
              // comments fetch failed, continue
            }
          }
        }
      } catch (e) {
        results.push({ type: "error", content: "answers fetch failed: " + e.message, likes: "0", author: "" })
      }

      return results.length > 0 ? results
        : [{ type: "info", content: "no data found for question " + qid, likes: "0", author: "" }]
    })

    return items
  }
}
