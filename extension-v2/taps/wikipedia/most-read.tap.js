export default {
  site: "wikipedia",
  name: "most-read",
  description: "Wikipedia most read articles today",
  url: "https://en.wikipedia.org",

  extract: async () => {
    const d = new Date()
    const y = d.getFullYear()
    const m = d.getMonth() + 1
    const day = d.getDate() - 1
    const url = `https://en.wikipedia.org/api/rest_v1/feed/featured/${y}/${String(m).padStart(2, '0')}/${String(day).padStart(2, '0')}`
    const res = await fetch(url)
    const data = await res.json()
    return (data.mostread?.articles || []).map(a => ({
      title: String(a.titles?.normalized || a.title),
      description: String(a.description || '-'),
      views: String(a.views || 0)
    }))
  }
}
