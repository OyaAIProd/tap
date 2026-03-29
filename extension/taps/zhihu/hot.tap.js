export default {
  site: "zhihu",
  name: "hot",
  description: "知乎热榜",
  url: "https://www.zhihu.com",

  extract: async () => {
    const res = await fetch('https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=50')
    const data = await res.json()
    return data.data.map((item, i) => ({
      rank: String(i + 1),
      title: item.target.title,
      heat: item.detail_text || ''
    }))
  }
}
