export default {
  site: "36kr",
  name: "hot",
  description: "36kr hot list - tech and startup news",
  url: "https://www.36kr.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot')
    const data = await res.json()
    if (data.code === 0 && data.data && data.data.hotRankList) {
      return data.data.hotRankList.map((item, i) => ({
        rank: String(i + 1),
        title: (item.templateMaterial && item.templateMaterial.widgetTitle) || item.title || '',
        hot: String(item.hotScore || item.statRead || 0)
      }))
    }
    // Fallback: newsflash API
    const res2 = await fetch('https://36kr.com/api/newsflash?b_id=0&per_page=20')
    const data2 = await res2.json()
    if (data2.code === 0 && data2.data && data2.data.items) {
      return data2.data.items.map((item, i) => ({
        rank: String(i + 1),
        title: item.title || '',
        hot: '0'
      }))
    }
    return []
  }
}
