export default {
  site: "x",
  name: "search",
  description: "Search X/Twitter posts",
  url: "https://x.com",
  args: { keyword: { type: "string" } },
  health: { min_rows: 3, non_empty: ["text"] },

  extract: async (args) => {
    // Navigate to search results
    location.href = 'https://x.com/search?q=' + encodeURIComponent(args.keyword) + '&src=typed_query&f=top'

    // Wait for results to load
    await new Promise(resolve => {
      let attempts = 0
      const check = () => {
        const tweets = document.querySelectorAll('[data-testid="tweet"]')
        if (tweets.length > 0 || attempts > 40) {
          resolve()
          return
        }
        attempts++
        setTimeout(check, 500)
      }
      check()
    })

    return Array.from(document.querySelectorAll('[data-testid="tweet"]')).map(el => {
      const userEl = el.querySelector('[data-testid="User-Name"]')
      const nameSpans = userEl ? userEl.querySelectorAll('span') : []
      let author = ''
      let handle = ''
      for (const s of nameSpans) {
        const t = (s.textContent || '').trim()
        if (t.startsWith('@')) { handle = t; break }
        if (t.length > 0 && !t.includes('·') && !t.match(/^\d/) && !author) author = t
      }

      const textEl = el.querySelector('[data-testid="tweetText"]')
      const text = textEl ? textEl.textContent.trim() : ''

      const metrics = el.querySelectorAll('[data-testid$="count"], [role="group"] span')
      const counts = []
      metrics.forEach(m => {
        const v = (m.textContent || '').trim()
        if (v && v !== '0') counts.push(v)
      })

      const timeEl = el.querySelector('time')
      const time = timeEl ? timeEl.getAttribute('datetime') || '' : ''

      const linkEl = el.querySelector('a[href*="/status/"]')
      const url = linkEl ? 'https://x.com' + linkEl.getAttribute('href') : ''

      return { author, handle, text: text.substring(0, 200), time, url }
    }).filter(item => item.text.length > 0)
  }
}
