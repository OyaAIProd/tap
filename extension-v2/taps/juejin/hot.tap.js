export default {
  site: "juejin",
  name: "hot",
  description: "掘金热门文章",
  url: "https://juejin.cn",

  extract: async () => {
    const res = await fetch('https://api.juejin.cn/content_api/v1/content/article_rank?category_id=1&type=hot&count=50', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    })
    const data = await res.json()
    return (data.data || []).map(item => ({
      title: String(item.content.title || ''),
      views: String(item.content.display_count || 0),
      author: String(item.author.name || '-')
    }))
  }
}
