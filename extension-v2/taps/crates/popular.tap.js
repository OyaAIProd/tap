export default {
  site: "crates",
  name: "popular",
  description: "crates.io popular Rust packages",
  url: "https://crates.io",
  health: { min_rows: 5, non_empty: ["name"] },

  extract: async () => {
    const res = await fetch('/api/v1/crates?page=1&per_page=50&sort=downloads')
    const data = await res.json()
    return data.crates.map(c => ({
      name: c.name,
      downloads: String(c.downloads),
      description: (c.description || '').substring(0, 60)
    }))
  }
}
