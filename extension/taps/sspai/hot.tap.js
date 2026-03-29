export default {
  site: "sspai",
  name: "hot",
  description: "少数派热门文章",
  url: "https://sspai.com",

  extract: async () => {
    const res = await fetch('https://sspai.com/api/v1/articles?offset=0&limit=50&sort=hottest_daily')
    const data = await res.json()
    return (data.list || data.data || []).map(a => ({
      title: String(a.title || ''),
      likes: String(a.like_count || a.likes || 0),
      author: String(a.author?.nickname || a.nickname || '-')
    }))
  }
}
