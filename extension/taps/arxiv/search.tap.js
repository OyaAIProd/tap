export default {
  site: "arxiv",
  name: "search",
  description: "Search arXiv papers",
  url: "https://arxiv.org",
  args: { keyword: { type: "string" } },
  health: { min_rows: 3, non_empty: ["title"] },

  extract: async (args) => {
    const params = new URLSearchParams({
      search_query: 'all:' + args.keyword,
      start: '0',
      max_results: '20',
      sortBy: 'relevance',
      sortOrder: 'descending'
    })
    const res = await fetch(
      'https://export.arxiv.org/api/query?' + params.toString()
    )
    const text = await res.text()
    const parser = new DOMParser()
    const xml = parser.parseFromString(text, 'text/xml')
    const entries = xml.querySelectorAll('entry')

    return Array.from(entries).map((entry, i) => {
      const title = (entry.querySelector('title')?.textContent || '').replace(/\s+/g, ' ').trim()
      const summary = (entry.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim()
      const authors = Array.from(entry.querySelectorAll('author name'))
        .map(n => n.textContent?.trim()).join(', ')
      const published = entry.querySelector('published')?.textContent?.split('T')[0] || ''
      const id = entry.querySelector('id')?.textContent || ''
      const categories = Array.from(entry.querySelectorAll('category'))
        .map(c => c.getAttribute('term')).filter(Boolean).join(', ')

      return {
        rank: String(i + 1),
        title,
        authors,
        published,
        categories,
        abstract: summary.substring(0, 300),
        url: id
      }
    })
  }
}
