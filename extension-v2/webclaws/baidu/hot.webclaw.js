export default {
  site: "baidu",
  name: "hot",
  description: "百度热搜榜",
  url: "https://www.baidu.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://top.baidu.com/api/board?platform=wise&tab=realtime')
    const data = await res.json()
    const list = (data.data && data.data.cards && data.data.cards[0] && data.data.cards[0].content) || []
    return list.map((item, i) => ({
      rank: String(i + 1),
      title: item.word || item.query || '',
      hot: String(item.hotScore || 0)
    }))
  }
}
