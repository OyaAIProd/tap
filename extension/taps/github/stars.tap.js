export default {
  site: "github",
  name: "stars",
  description: "GitHub starred repositories (requires login)",
  url: "https://github.com/stars",
  health: { min_rows: 1, non_empty: ["repo"] },

  extract: async () => {
    // Use GitHub API with credentials from browser session
    const res = await fetch(
      'https://api.github.com/user/starred?per_page=30&sort=created',
      { credentials: 'include', headers: { 'Accept': 'application/vnd.github.v3+json' } }
    )

    if (res.status === 401) {
      // Fallback: parse DOM from stars page
      return Array.from(document.querySelectorAll('.d-block, [data-hydro-click*="star"]')).map((el, i) => {
        const link = el.querySelector('a[href*="/"]')
        const repo = link?.textContent?.trim()?.replace(/\s+/g, '') || ''
        const desc = el.querySelector('p')?.textContent?.trim() || ''
        return { rank: String(i + 1), repo, description: desc, stars: '', language: '' }
      }).filter(item => item.repo.includes('/'))
    }

    const data = await res.json()
    return data.map((item, i) => ({
      rank: String(i + 1),
      repo: item.full_name,
      description: (item.description || '').substring(0, 120),
      stars: String(item.stargazers_count || 0),
      language: item.language || ''
    }))
  }
}
