export default {
  site: "reddit",
  name: "search",
  description: "Search Reddit posts",
  url: "https://www.reddit.com/",
  args: { keyword: { type: "string" } },
  health: { min_rows: 3, non_empty: ["title"] },

  extract: async (args) => {
    const params = new URLSearchParams({
      q: args.keyword,
      limit: '30',
      raw_json: '1',
      sort: 'relevance',
      t: 'all'
    })
    const res = await fetch(
      'https://www.reddit.com/search.json?' + params.toString()
    )
    const data = await res.json()
    return (data.data?.children || []).map((child, i) => ({
      rank: String(i + 1),
      title: child.data.title,
      subreddit: child.data.subreddit_name_prefixed || child.data.subreddit,
      score: String(child.data.score || 0),
      comments: String(child.data.num_comments || 0),
      url: 'https://reddit.com' + child.data.permalink
    }))
  }
}
