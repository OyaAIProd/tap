export default {
  site: "weibo",
  name: "detail",
  description: "读取当前已打开微博帖子的详情+评论（API优先）",
  columns: ["type", "content", "likes", "author"],
  args: {},
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page) {
    // Extract mid from current URL
    const mid = await page.eval(() => {
      const url = location.href
      // m.weibo.cn/detail/{mid} or weibo.com/{uid}/{mid}
      const mMatch = url.match(/m\.weibo\.cn\/detail\/(\w+)/)
      if (mMatch) return mMatch[1]
      const match = url.match(/weibo\.com\/\d+\/(\w+)/)
      if (match) return match[1]
      return null
    })

    if (!mid) {
      return [{ type: "error", content: "not on a weibo post page — call open first", likes: "0", author: "" }]
    }

    const items = await page.eval(async (mid) => {
      const results = []

      // Fetch post detail via API
      try {
        const detailRes = await fetch("https://m.weibo.cn/statuses/show?id=" + mid, { credentials: "include" })
        const detailData = await detailRes.json()
        const post = detailData.data || {}
        const text = (post.text || "").replace(/<[^>]+>/g, "").trim()

        results.push({
          type: "post",
          content: text.substring(0, 500),
          likes: String(post.attitudes_count || 0),
          author: String(post.user?.screen_name || "")
        })

        results.push({
          type: "engagement",
          content: "likes:" + (post.attitudes_count || 0) + " comments:" + (post.comments_count || 0) + " reposts:" + (post.reposts_count || 0),
          likes: String(post.attitudes_count || 0),
          author: ""
        })
      } catch (e) {
        results.push({ type: "error", content: "detail fetch failed: " + e.message, likes: "0", author: "" })
      }

      // Fetch comments via API
      try {
        const commentsRes = await fetch("https://m.weibo.cn/api/comments/show?id=" + mid + "&page=1", { credentials: "include" })
        const commentsData = await commentsRes.json()
        const comments = commentsData.data?.data || []

        for (const c of comments) {
          const text = (c.text || "").replace(/<[^>]+>/g, "").trim()
          if (text.length < 2) continue
          results.push({
            type: "comment",
            content: text.substring(0, 300),
            likes: String(c.like_count || 0),
            author: String(c.user?.screen_name || "")
          })
        }
      } catch (e) {
        results.push({ type: "error", content: "comments fetch failed: " + e.message, likes: "0", author: "" })
      }

      return results.length > 0 ? results
        : [{ type: "info", content: "no data found for mid " + mid, likes: "0", author: "" }]
    }, mid)

    return items
  }
}
