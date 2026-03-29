export default {
  site: "reddit",
  name: "hot",
  description: "Reddit Hot Posts",
  url: "https://www.reddit.com/",

  extract: async () => {
    const res = await fetch('https://www.reddit.com/r/popular/hot.json?limit=50&raw_json=1')
    const data = await res.json()
    return data.data.children.map((child, i) => ({
      rank: String(i + 1),
      title: child.data.title,
      subreddit: child.data.subreddit_name_prefixed || child.data.subreddit,
      score: String(child.data.score || 0)
    }))
  }
}
