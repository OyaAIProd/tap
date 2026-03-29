export default {
  site: "github",
  name: "trending",
  description: "GitHub Trending repositories",
  url: "https://github.com/trending",
  waitFor: "article.Box-row",
  timeout: 10000,

  extract: () => {
    return Array.from(document.querySelectorAll('article.Box-row')).map(el => {
      const repo = el.querySelector('h2 a')?.textContent?.trim().replace(/\s+/g, '') || ''
      const descEl = el.querySelector('p.col-9')
      const description = descEl ? descEl.textContent.trim() : ''
      const stars = el.querySelector('[href$="/stargazers"]')?.textContent?.trim() || ''
      const language = el.querySelector('[itemprop="programmingLanguage"]')?.textContent?.trim() || ''
      return { repo, description, stars, language }
    }).filter(item => item.repo.length > 0)
  }
}
