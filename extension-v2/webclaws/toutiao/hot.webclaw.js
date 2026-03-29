export default {
  site: "toutiao",
  name: "hot",
  description: "头条热榜",
  url: "https://www.toutiao.com",

  extract: async () => {
    const res = await fetch('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc')
    const data = await res.json()
    return (data.data || []).map((item, i) => ({
      rank: String(i + 1),
      title: item.Title || '',
      hot: String(item.HotValue || 0)
    }))
  }
}
