export default {
  site: "bilibili",
  name: "detail",
  description: "读取当前B站视频的详情+评论（从API提取）",
  columns: ["type", "content", "likes", "author"],
  args: {},
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page) {
    const info = await page.eval(() => {
      const bvMatch = location.pathname.match(/BV\w+/)
      return { bvid: bvMatch ? bvMatch[0] : '' }
    })

    if (!info.bvid) {
      return [{ type: "error", content: "not on a bilibili video page", likes: "0", author: "" }]
    }

    // Fetch video detail via API
    const viewData = await page.fetch(
      `https://api.bilibili.com/x/web-interface/view?bvid=${info.bvid}`
    )

    const results = []
    const video = viewData?.data || {}
    const stat = video.stat || {}

    results.push({
      type: "note",
      content: (video.title || "") + "\n" + (video.desc || "").substring(0, 500),
      likes: String(stat.like || 0),
      author: String((video.owner || {}).name || "")
    })

    results.push({
      type: "engagement",
      content: "views:" + (stat.view || 0) + " likes:" + (stat.like || 0) + " coins:" + (stat.coin || 0) + " favorites:" + (stat.favorite || 0) + " comments:" + (stat.reply || 0),
      likes: String(stat.like || 0),
      author: ""
    })

    // Fetch comments via API using aid from view response
    const aid = video.aid || stat.aid || 0
    if (aid) {
      const commentData = await page.fetch(
        `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${aid}&mode=3`
      )
      const replies = commentData?.data?.replies || []
      for (const c of replies) {
        const text = (c.content || {}).message || ""
        if (text.length < 2) continue
        results.push({
          type: "comment",
          content: text.substring(0, 300),
          likes: String(c.like || 0),
          author: String((c.member || {}).uname || "")
        })

        for (const sc of (c.replies || [])) {
          const subText = (sc.content || {}).message || ""
          if (subText.length < 2) continue
          results.push({
            type: "reply",
            content: subText.substring(0, 300),
            likes: String(sc.like || 0),
            author: String((sc.member || {}).uname || "")
          })
        }
      }
    }

    if (results.length === 0) {
      results.push({ type: "info", content: "no video detail found — call open first", likes: "0", author: "" })
    }
    return results
  }
}
