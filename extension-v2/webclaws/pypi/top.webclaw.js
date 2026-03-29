export default {
  site: "pypi",
  name: "top",
  description: "PyPI top Python packages",
  url: "https://pypi.org",
  health: { min_rows: 10, non_empty: ["project"] },

  extract: async () => {
    const res = await fetch("https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.min.json", { credentials: 'include' })
    const data = await res.json()
    return data.rows.map(item => ({
      project: item.project,
      download_count: String(item.download_count)
    }))
  }
}
