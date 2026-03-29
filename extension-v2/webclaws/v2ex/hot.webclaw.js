export default {
  site: "v2ex",
  name: "hot",
  description: "V2EX 热门话题",
  url: "https://www.v2ex.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch("https://www.v2ex.com/api/topics/hot.json", { credentials: 'include' })
    const data = await res.json()
    return data.map(item => ({
      title: String(item.title || ''),
      node: String((item.node && item.node.title) || ''),
      replies: String(item.replies || 0)
    }))
  }
}
