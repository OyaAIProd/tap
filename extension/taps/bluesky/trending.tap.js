export default {
  site: "bluesky",
  name: "trending",
  description: "Bluesky Trending Topics",
  url: "https://bsky.app",
  health: { min_rows: 3, non_empty: ["topic"] },

  extract: async () => {
    const res = await fetch("https://public.api.bsky.app/xrpc/app.bsky.unspecced.getTrendingTopics", { credentials: 'include' })
    const data = await res.json()
    const topics = data.topics || []
    return topics.map(item => ({
      topic: item.topic
    }))
  }
}
