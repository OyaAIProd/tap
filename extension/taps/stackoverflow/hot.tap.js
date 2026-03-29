export default {
  site: "stackoverflow",
  name: "hot",
  description: "StackOverflow hot questions",
  url: "https://stackoverflow.com",
  health: { min_rows: 5, non_empty: ["title"] },

  extract: async () => {
    const res = await fetch('https://api.stackexchange.com/2.3/questions?order=desc&sort=hot&site=stackoverflow&pagesize=50')
    const data = await res.json()
    return data.items.map((q, i) => ({
      rank: String(i + 1),
      title: q.title,
      score: String(q.score),
      answers: String(q.answer_count),
      tags: q.tags.join(', ')
    }))
  }
}
