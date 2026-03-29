export default {
  site: "devto",
  name: "top",
  description: "Dev.to top articles",
  url: "https://dev.to",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch("https://dev.to/api/articles?per_page=50&state=rising", { credentials: 'include' })
    const data = await res.json()
    return data.map(item => ({
      title: item.title,
      reactions: String(item.positive_reactions_count),
      comments: String(item.comments_count),
      author: item.user.name
    }))
  }
}
