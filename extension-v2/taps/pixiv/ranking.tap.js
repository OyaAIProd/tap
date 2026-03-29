export default {
  site: "pixiv",
  name: "ranking",
  description: "Pixiv daily illustration ranking",
  url: "https://www.pixiv.net",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch("https://www.pixiv.net/ranking.php?mode=daily&content=all&p=1&format=json", { credentials: 'include' })
    const data = await res.json()
    const contents = data.contents || []
    return contents.map(item => ({
      rank: String(item.rank),
      title: String(item.title),
      author: String(item.user_name),
      views: String(item.view_count)
    }))
  }
}
