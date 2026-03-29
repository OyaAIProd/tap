export default {
  site: "hackernews",
  name: "hot",
  description: "Hacker News top stories",
  url: "https://news.ycombinator.com/",

  extract: () => {
    const items = []
    document.querySelectorAll('.athing').forEach((row) => {
      const rank = (row.querySelector('.rank') || {}).textContent || ''
      const titleEl = row.querySelector('.titleline > a')
      const title = titleEl ? titleEl.textContent.trim() : ''
      const subRow = row.nextElementSibling
      const scoreEl = subRow ? subRow.querySelector('.score') : null
      const score = scoreEl ? scoreEl.textContent.replace(/[^0-9]/g, '') : '0'
      if (title) {
        items.push({
          rank: rank.replace('.', '').trim() || String(items.length + 1),
          title,
          hot: score
        })
      }
    })
    return items
  }
}
