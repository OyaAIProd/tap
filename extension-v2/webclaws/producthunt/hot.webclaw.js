export default {
  site: "producthunt",
  name: "hot",
  description: "Product Hunt today's hot products",
  url: "https://www.producthunt.com/",
  waitFor: '[data-test="post-item"], [class*="post-item"], main section',
  timeout: 10000,
  health: { min_rows: 5, non_empty: ["title"] },

  extract: () => {
    const items = []
    const products = document.querySelectorAll('[data-test="post-item"], .styles_item__Dk_nz, [class*="post-item"], main section > div > div')
    products.forEach((el, i) => {
      const titleEl = el.querySelector('a[href*="/posts/"] strong, a[href*="/posts/"] h3, [data-test="post-name"], strong')
      const votesEl = el.querySelector('[class*="vote"] button, [data-test="vote-button"], button[aria-label*="vote"]')
      const title = titleEl ? titleEl.textContent.trim() : ''
      const votes = votesEl ? votesEl.textContent.replace(/[^0-9]/g, '') : '0'
      if (title && title.length > 1) {
        items.push({ rank: String(i + 1), title: title, hot: votes })
      }
    })
    // Fallback: find all product links
    if (items.length === 0) {
      const links = document.querySelectorAll('a[href*="/posts/"]')
      const seen = new Set()
      links.forEach((a) => {
        const text = a.textContent.trim().split('\n')[0].trim()
        if (text && text.length > 2 && text.length < 150 && !seen.has(text)) {
          seen.add(text)
          items.push({ rank: String(items.length + 1), title: text, hot: '0' })
        }
      })
    }
    return items
  }
}
