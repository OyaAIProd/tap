export default {
  site: "xiaohongshu",
  name: "daily_ops",
  description: "小红书每日运营闭环：监控→发帖→互动→复盘",
  columns: ["followers", "published", "likes_given", "comments_given", "follows_given", "replies", "new_followers", "best_note", "hot_topic"],
  args: {
    keyword: { type: "string", default: "AI", description: "互动领域关键词" },
    reply_text: { type: "string", default: "说得好！关注了 🙏", description: "自动回复文案" },
    engage_count: { type: "int", default: 5, description: "主动互动笔记数" },
    skip_publish: { type: "boolean", default: false, description: "跳过发帖" },
    skip_engage: { type: "boolean", default: false, description: "跳过主动互动" }
  },

  async run(page, args) {
    const result = {
      followers: "0", published: "skipped",
      likes_given: "0", comments_given: "0", follows_given: "0",
      replies: "0", new_followers: "0",
      best_note: "", hot_topic: ""
    }

    // ═══ Phase 1: 监控 ═══
    try {
      const profile = await page.tap("xiaohongshu", "profile")
      result.followers = profile[0]?.followers || "0"
    } catch { /* profile 获取失败 */ }

    try {
      const notes = await page.tap("xiaohongshu", "my_notes")
      if (notes.length > 0) {
        const sorted = notes.sort((a, b) => Number(b.likes || 0) - Number(a.likes || 0))
        result.best_note = sorted[0]?.title || ""
      }
    } catch { /* 无笔记 */ }

    // ═══ Phase 2: 追热点发帖 ═══
    let hotTopic = ""
    try {
      const hot = await page.tap("xiaohongshu", "hot")
      hotTopic = hot[0]?.title || ""
      result.hot_topic = hotTopic
    } catch { /* 热点获取失败 */ }

    if (!args.skip_publish && hotTopic) {
      try {
        // 导航到发布页
        await page.nav("https://creator.xiaohongshu.com/publish/publish?source=official")
        await page.wait(3000)

        const title = hotTopic.length > 18 ? hotTopic.slice(0, 18) + "…" : hotTopic
        const content = generatePost(hotTopic)

        await page.tap("xiaohongshu", "publish_text", { title, content })
        result.published = hotTopic
      } catch { result.published = "failed" }
    }

    // ═══ Phase 3: 回复自己的评论 ═══
    try {
      const notifs = await page.tap("xiaohongshu", "notifications")
      result.new_followers = String(notifs.filter(n => n.type === "follower").length)

      const comments = notifs.filter(n => n.type === "comment").slice(0, 5)
      let replyCount = 0
      for (const c of comments) {
        try {
          await page.tap("xiaohongshu", "reply", {
            note_id: c.note_id || "", comment_index: 1, text: args.reply_text
          })
          replyCount++
          await page.wait(2000)
        } catch { /* 单条失败不影响 */ }
      }
      result.replies = String(replyCount)
    } catch { /* 通知失败 */ }

    // ═══ Phase 4: 主动互动（搜索同领域 → 打开 → 点赞+评论+关注）═══
    if (!args.skip_engage) {
      let likesGiven = 0, commentsGiven = 0, followsGiven = 0
      try {
        const posts = await page.tap("xiaohongshu", "search", { keyword: args.keyword })
        const targets = posts.slice(0, args.engage_count)

        for (const post of targets) {
          try {
            // 打开笔记
            await page.tap("xiaohongshu", "open", { keyword: args.keyword, index: 1 })
            await page.wait(2000)

            // 点赞
            try { await page.tap("xiaohongshu", "like"); likesGiven++ } catch {}

            // 评论
            try {
              await page.tap("xiaohongshu", "comment", { text: generateComment(post.title || "") })
              commentsGiven++
            } catch {}

            // 关注
            try { await page.tap("xiaohongshu", "follow"); followsGiven++ } catch {}

            await page.wait(3000) // 防频控
          } catch { /* 单个互动失败继续下一个 */ }
        }
      } catch { /* 搜索失败 */ }

      result.likes_given = String(likesGiven)
      result.comments_given = String(commentsGiven)
      result.follows_given = String(followsGiven)
    }

    return [result]
  }
}

function generatePost(topic) {
  const hooks = ["看到这个话题真的绷不住了", "必须来聊聊这个", "不知道大家怎么看", "认真分析一下"]
  const hook = hooks[Math.floor(Math.random() * hooks.length)]
  return `${hook}——${topic}

最近这个话题热度很高，说说我的看法：

1️⃣ 首先值得关注的是核心变化
2️⃣ 其次要看到背后的趋势
3️⃣ 最后想说说对我们的影响

你怎么看？评论区聊聊👇

#${topic.replace(/\s+/g, '')} #热点分析 #每日思考`
}

function generateComment(title) {
  const templates = [
    "写得好！学到了 👍",
    "这个观点很有意思，关注了",
    "分析得很到位！",
    "同感！期待更多分享 ✨",
    "收藏了，太实用了"
  ]
  return templates[Math.floor(Math.random() * templates.length)]
}
