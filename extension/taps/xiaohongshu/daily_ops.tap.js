export default {
  site: "xiaohongshu",
  name: "daily_ops",
  description: "小红书每日运营：监控数据→回复评论→追热点→生成报告",
  columns: ["followers", "best_note", "hot_topic", "replies", "new_followers"],
  args: {
    reply_text: { type: "string", default: "谢谢关注！🙏" }
  },

  async run(page, args) {
    // Step 1: 读取账号数据
    const profile = await page.tap("xiaohongshu", "profile")
    const followers = profile[0]?.followers || "0"

    // Step 2: 读取笔记表现，找最佳笔记
    let bestNote = ""
    try {
      const notes = await page.tap("xiaohongshu", "my_notes")
      if (notes.length > 0) {
        const sorted = notes.sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
        bestNote = sorted[0]?.title || ""
      }
    } catch { /* 可能没有笔记 */ }

    // Step 3: 读取通知，自动回复评论
    let replyCount = 0
    let newFollowerCount = 0
    try {
      const notifs = await page.tap("xiaohongshu", "notifications")
      newFollowerCount = notifs.filter(n => n.type === "follower").length

      // 回复评论通知（最多回复 5 条）
      const comments = notifs.filter(n => n.type === "comment").slice(0, 5)
      for (const c of comments) {
        try {
          await page.tap("xiaohongshu", "reply", {
            note_id: c.note_id || "",
            comment_index: 1,
            text: args.reply_text
          })
          replyCount++
          await page.wait(2000) // 避免频率限制
        } catch { /* 单条回复失败不影响整体 */ }
      }
    } catch { /* 通知读取失败 */ }

    // Step 4: 获取热点话题
    let hotTopic = ""
    try {
      const hot = await page.tap("xiaohongshu", "hot")
      hotTopic = hot[0]?.title || ""
    } catch { /* 热点获取失败 */ }

    return [{
      followers,
      best_note: bestNote,
      hot_topic: hotTopic,
      replies: String(replyCount),
      new_followers: String(newFollowerCount)
    }]
  }
}
