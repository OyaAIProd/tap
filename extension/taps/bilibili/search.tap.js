export default {
  site: "bilibili",
  name: "search",
  description: "搜索B站视频（API提取）",
  url: "https://www.bilibili.com",
  args: {
    keyword: { type: "string" }
  },
  health: { min_rows: 3, non_empty: ["title"] },

  extract: async (args) => {
    const res = await fetch(
      `https://api.bilibili.com/x/web-interface/wbi/search/type?search_type=video&keyword=${encodeURIComponent(args.keyword)}`,
      { credentials: 'include' }
    )
    const data = await res.json()
    const results = data?.data?.result || []
    return results.map(v => ({
      title: String(v.title || '').replace(/<[^>]*>/g, ''),
      author: String(v.author || ''),
      views: String(v.play || 0),
      likes: String(v.like || 0),
      bvid: String(v.bvid || ''),
      url: 'https://www.bilibili.com/video/' + (v.bvid || '')
    })).filter(v => v.title.length > 0)
  }
}
