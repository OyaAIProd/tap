export default {
  site: "douban",
  name: "hot",
  description: "豆瓣热门电影",
  url: "https://movie.douban.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://movie.douban.com/j/search_subjects?type=movie&tag=%E7%83%AD%E9%97%A8&page_limit=50&page_start=0')
    const data = await res.json()
    return data.subjects.map((m, i) => ({
      rank: String(i + 1),
      title: m.title,
      rate: m.rate || '-'
    }))
  }
}
