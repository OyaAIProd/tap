export default {
  site: "bilibili",
  name: "hot",
  description: "B站热门视频",
  url: "https://www.bilibili.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://api.bilibili.com/x/web-interface/ranking/v2', { credentials: 'include' })
    const data = await res.json()
    return data.data.list.map(v => ({
      title: v.title,
      author: v.owner.name,
      views: String(v.stat.view),
      url: 'https://bilibili.com/video/' + v.bvid
    }))
  }
}
