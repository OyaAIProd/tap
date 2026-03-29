export default {
  site: "medium",
  name: "search",
  description: "Search Medium articles",
  url: "https://medium.com",
  args: { keyword: { type: "string" } },
  health: { min_rows: 3, non_empty: ["title"] },

  extract: async (args) => {
    // Medium uses a GraphQL-based search via tag/search pages
    const searchUrl = 'https://medium.com/search?q=' + encodeURIComponent(args.keyword)
    location.href = searchUrl

    await new Promise(resolve => {
      let attempts = 0
      const check = () => {
        const articles = document.querySelectorAll('article, [data-testid="postPreview"]')
        if (articles.length > 0 || attempts > 40) {
          resolve()
          return
        }
        attempts++
        setTimeout(check, 500)
      }
      check()
    })

    return Array.from(document.querySelectorAll('article')).map((el, i) => {
      const titleEl = el.querySelector('h2, h3')
      const title = titleEl?.textContent?.trim() || ''
      const subtitleEl = el.querySelector('h3, p')
      const subtitle = (subtitleEl && subtitleEl !== titleEl) ? subtitleEl.textContent?.trim() : ''
      const authorEl = el.querySelector('a[data-testid="authorName"], p > a')
      const author = authorEl?.textContent?.trim() || ''
      const timeEl = el.querySelector('time, span[data-testid="storyPublishDate"]')
      const time = timeEl?.textContent?.trim() || ''
      const linkEl = el.querySelector('a[aria-label], h2 a, h3 a, a[data-testid]')
      const href = linkEl?.getAttribute('href') || ''
      const url = href.startsWith('http') ? href : (href ? 'https://medium.com' + href : '')
      const clapEl = el.querySelector('[data-testid="clapCount"], button[aria-label*="clap"] span')
      const claps = clapEl?.textContent?.trim() || '0'

      return {
        rank: String(i + 1),
        title,
        subtitle: (subtitle || '').substring(0, 120),
        author,
        claps,
        time,
        url
      }
    }).filter(item => item.title.length > 0)
  }
}
