export default {
  site: "douyin",
  name: "detail",
  description: "读取当前已打开视频的详情+评论（从API提取）",
  columns: ["type", "content", "likes", "author"],
  args: {},
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page) {
    // Get aweme_id from current URL
    const awemeId = await page.eval(() => {
      const m = location.pathname.match(/video\/(\d+)/)
      return m ? m[1] : null
    })

    if (!awemeId) {
      return [{ type: "error", content: "not on a video page — call open first", likes: "0", author: "" }]
    }

    const results = []

    // Fetch video detail
    try {
      const detailParams = new URLSearchParams({
        aweme_id: awemeId,
        device_platform: 'webapp',
        aid: '6383'
      })
      const detailData = await page.fetch(
        'https://www.douyin.com/aweme/v1/web/aweme/detail/?' + detailParams.toString()
      )
      const detail = detailData?.aweme_detail
      if (detail) {
        const stats = detail.statistics || {}
        results.push({
          type: "video",
          content: (detail.desc || "").substring(0, 500),
          likes: String(stats.digg_count || 0),
          author: (detail.author || {}).nickname || ""
        })
        results.push({
          type: "engagement",
          content: "likes:" + (stats.digg_count || 0) + " comments:" + (stats.comment_count || 0) + " shares:" + (stats.share_count || 0) + " plays:" + (stats.play_count || 0),
          likes: String(stats.digg_count || 0),
          author: ""
        })
      }
    } catch (e) {
      results.push({ type: "error", content: "detail API failed: " + e.message, likes: "0", author: "" })
    }

    // Fetch comments
    try {
      const commentParams = new URLSearchParams({
        aweme_id: awemeId,
        cursor: '0',
        count: '20',
        device_platform: 'webapp',
        aid: '6383'
      })
      const commentData = await page.fetch(
        'https://www.douyin.com/aweme/v1/web/comment/list/?' + commentParams.toString()
      )
      const comments = commentData?.comments || []
      for (const c of comments) {
        const text = c.text || ''
        if (text.length < 2) continue
        results.push({
          type: "comment",
          content: text.substring(0, 300),
          likes: String(c.digg_count || 0),
          author: (c.user || {}).nickname || ""
        })
      }
    } catch (e) {
      results.push({ type: "error", content: "comments API failed: " + e.message, likes: "0", author: "" })
    }

    if (results.length === 0) {
      results.push({ type: "info", content: "no detail available — check if logged in", likes: "0", author: "" })
    }

    return results
  }
}
