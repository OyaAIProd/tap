export default {
  site: "weibo-to-xiaohongshu",
  name: "auto_publish",
  description: "微博热点转小红书笔记自动化 — 获取热搜→生成内容→发布",
  columns: ["status", "topic", "note_url"],
  args: {
    hot_index: { type: "int", default: 1, description: "选择微博热搜第 N 个话题" }
  },

  async run(page, args) {
    const hotIndex = args.hot_index || 1
    
    // Step 1: 获取微博热搜
    const hotData = await page.tap("weibo", "hot")
    if (!hotData || hotData.length === 0) {
      return [{ status: "error-weibo", topic: "", note_url: "" }]
    }
    
    const topic = hotData[hotIndex - 1] || hotData[0]
    const topicTitle = topic.title
    const noteContent = generateContent(topicTitle)
    
    // Step 2: 导航到小红书发布页面
    await page.nav("https://creator.xiaohongshu.com/publish/publish?source=official")
    await page.wait(4000)
    
    // Step 3: 发布笔记（纯文字，跳过图片上传）
    // 直接在当前页面填写标题和内容
    if (noteContent.title) {
      await page.type("input.d-text", noteContent.title)
      await page.wait(500)
    }
    if (noteContent.content) {
      await page.type(".tiptap.ProseMirror", noteContent.content)
      await page.wait(500)
    }
    await page.click("发布")
    await page.wait(5000)
    const url = await page.eval("location.href")
    const result = [{ status: url.includes("/publish/publish") ? "check-browser" : "published", url }]
    
    return [{
      status: result[0]?.status || "published",
      topic: topicTitle,
      note_url: result[0]?.url || ""
    }]
  }
}

function generateContent(topicTitle) {
  const emojis = ["😭", "🔥", "❗", "💡", "✨"]
  const emoji = emojis[Math.floor(Math.random() * emojis.length)]
  
  const title = `${topicTitle} ${emoji}`
  
  const content = `今天微博热搜看到${topicTitle}的消息，真的很有感触！

作为深度关注者，想和大家分享几点思考：
✅ 第一点值得注意
✅ 第二点很关键  
✅ 第三点不能忽视

大家怎么看这件事？评论区聊聊～

#热点讨论 #今日话题 #社会热点 #小红书热点`
  
  return { title: title.substring(0, 20), content }
}
