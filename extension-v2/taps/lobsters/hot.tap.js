export default {
  site: "lobsters",
  name: "hot",
  description: "Lobsters hot posts",
  url: "https://lobste.rs",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://lobste.rs/hottest.json')
    const data = await res.json()
    return data.map((t, i) => ({
      rank: String(i + 1),
      title: t.title,
      score: String(t.score),
      tags: t.tags.join(', '),
      comments: String(t.comment_count)
    }))
  }
}
