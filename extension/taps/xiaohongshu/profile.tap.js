export default {
  site: "xiaohongshu",
  name: "profile",
  description: "读取小红书创作者中心的账号数据",
  columns: ["followers", "following", "likes_collects", "views", "likes", "comments", "collects", "shares"],
  health: { min_rows: 1, non_empty: ["followers"] },

  async run(page) {
    await page.nav("https://creator.xiaohongshu.com/new/home")
    // Wait for stats to render — more reliable than fixed wait
    await page.waitFor('[class*="count"], [class*="data"], [class*="overview"], .fans-count', 8000)

    return await page.eval(() => {
      const text = document.body?.innerText || ""

      // Parse "label\nvalue" pairs from page text
      const pairs = {}
      const lines = text.split("\n").map(l => l.trim()).filter(Boolean)
      for (let i = 0; i < lines.length - 1; i++) {
        // "关注数" → next line is value, "粉丝数" → next line is value
        if (/^(关注数|粉丝数|获赞与收藏)$/.test(lines[i])) {
          pairs[lines[i]] = lines[i + 1]
        }
        // Stats section: "曝光数" etc in the data dashboard
        if (/^(曝光数|观看数|点赞数|评论数|收藏数|分享数|净涨粉|新增关注|取消关注|主页访客)$/.test(lines[i])) {
          pairs[lines[i]] = lines[i + 1]
        }
      }

      // Also try: "N\n粉丝数" pattern (value before label)
      for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "粉丝数" && /^[\d,]+$/.test(lines[i - 1])) {
          pairs["粉丝数"] = lines[i - 1]
        }
        if (lines[i] === "关注数" && /^[\d,]+$/.test(lines[i - 1])) {
          pairs["关注数"] = lines[i - 1]
        }
        if (lines[i] === "获赞与收藏" && /^[\d,]+$/.test(lines[i - 1])) {
          pairs["获赞与收藏"] = lines[i - 1]
        }
      }

      return [{
        followers: pairs["粉丝数"] || "0",
        following: pairs["关注数"] || "0",
        likes_collects: pairs["获赞与收藏"] || "0",
        views: pairs["曝光数"] || "0",
        likes: pairs["点赞数"] || "0",
        comments: pairs["评论数"] || "0",
        collects: pairs["收藏数"] || "0",
        shares: pairs["分享数"] || "0"
      }]
    })
  }
}
