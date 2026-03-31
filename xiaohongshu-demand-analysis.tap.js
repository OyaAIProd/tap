export default {
  site: "xiaohongshu",
  name: "demand_analysis",
  description: "小红书需求挖掘 - 找成熟需求下的长尾空白",
  columns: ["category", "mature_demand", "gap", "opportunity"],
  args: {},

  async run(page, args) {
    const searchQueries = [
      { q: "小程序 求推荐", type: "需求表达" },
      { q: "有没有小程序可以", type: "需求表达" },
      { q: "小程序 替代", type: "替代方案" },
      { q: "小程序 不好用", type: "痛点" },
      { q: "求推荐 工具 小程序", type: "需求表达" },
      { q: "小程序 平替", type: "替代方案" },
      { q: "免费 小程序", type: "价格敏感" },
      { q: "小程序 会员 太贵", type: "价格痛点" },
      { q: "学生党 小程序", type: "人群需求" },
      { q: "打工人 必备小程序", type: "场景需求" }
    ]

    const results = []

    for (const item of searchQueries) {
      try {
        await page.nav(`https://www.xiaohongshu.com/search/result?keyword=${encodeURIComponent(item.q)}`)
        await page.waitFor('[data-type="note"], [class*="note-card"]', 15000)
        
        const data = await page.eval((query) => {
          const notes = document.querySelectorAll('[data-type="note"], [class*="note-card"]').slice(0, 20)
          const extracted = []
          
          notes.forEach(note => {
            const title = note.querySelector('[class*="title"]')?.innerText || ""
            const desc = note.innerText || ""
            const likes = note.querySelector('[class*="like"]')?.innerText || "0"
            
            if (title || desc) {
              extracted.push({
                title: title.substring(0, 60),
                engagement: likes.replace(/[^0-9]/g, "") || "0"
              })
            }
          })
          
          return { query, notes: extracted }
        }, item.q)
        
        results.push({
          category: item.type,
          mature_demand: item.q,
          gap: data.notes.slice(0, 3).map(n => n.title).join(" | "),
          opportunity: data.notes.length > 0 ? "有需求" : "待验证"
        })
      } catch (e) {
        results.push({
          category: item.type,
          mature_demand: item.q,
          gap: e.message,
          opportunity: "error"
        })
      }
    }

    return results
  }
}
