export default {
  site: "wechat",
  name: "verify_demand",
  description: "快速验证小程序需求 - 搜索关键词看现有产品",
  columns: ["keyword", "result_count", "top_products", "opportunity"],
  args: {
    keyword: { type: "string", required: true }
  },

  async run(page, args) {
    const keyword = encodeURIComponent(args.keyword)
    
    await page.nav(`https://weixin.sogou.com/weixin?type=2&query=${keyword}`)
    
    try {
      await page.waitFor(".news-list li, .news-box li", 10000)
      await page.wait(2000)
    } catch (e) {
      return [{
        keyword: args.keyword,
        result_count: 0,
        top_products: "Search blocked or no results",
        opportunity: "待验证 - 搜索受限"
      }]
    }

    const data = await page.eval(() => {
      const articles = document.querySelectorAll('.news-list li, .news-box li')
      const count = articles.length
      
      const products = []
      for (let i = 0; i < Math.min(articles.length, 10); i++) {
        const el = articles[i]
        const title = (el.querySelector('h3 a')?.innerText || '').trim()
        const author = (el.querySelector('.account, .s-p a')?.innerText || '').trim()
        
        if (title) products.push(`${title}`)
      }
      
      return { count, products }
    })

    let opportunity = "🟡 需进一步验证"
    if (data.count > 100) opportunity = "🔴 红海 - 但可差异化"
    else if (data.count > 30) opportunity = "🟢 有机会 - 需求被验证"
    else if (data.count > 0) opportunity = "🟢 蓝海 - 可能是新机会"

    return [{
      keyword: args.keyword,
      result_count: data.count,
      top_products: data.products.slice(0, 5).join(" | "),
      opportunity
    }]
  }
}
