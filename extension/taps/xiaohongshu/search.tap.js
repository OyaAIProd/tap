export default {
  site: "xiaohongshu",
  name: "search",
  description: "搜索小红书笔记（SSR state提取，含评论数、收藏数）",
  url: "https://www.xiaohongshu.com",
  args: { keyword: { type: "string" } },
  health: { min_rows: 3, non_empty: ["title"] },

  extract: async (args) => {
    const searchUrl = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(args.keyword)}&type=51`
    const res = await fetch(searchUrl, { credentials: 'include' })
    const html = await res.text()

    const stateMatch = html.match(/__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*<\/script>/)
    if (stateMatch) {
      try {
        const raw = stateMatch[1].replace(/:undefined/g, ':null').replace(/,undefined/g, ',null')
        const state = JSON.parse(raw)
        let feeds = state?.search?.feeds
        if (feeds?._rawValue) feeds = feeds._rawValue
        if (feeds?._value) feeds = feeds._value
        if (Array.isArray(feeds)) {
          return feeds.map(item => {
            const nc = item?.noteCard || {}
            const interact = nc?.interactInfo || {}
            return {
              title: String(nc?.displayTitle || ''),
              likes: String(interact?.likedCount || '0'),
              comments: String(interact?.commentCount || '0'),
              collects: String(interact?.collectedCount || '0'),
              author: String(nc?.user?.nickname || ''),
              note_id: String(item?.id || '')
            }
          }).filter(item => item.title.length > 0)
        }
      } catch (e) { /* fall through to DOM */ }
    }

    // Fallback: parse DOM
    return Array.from(document.querySelectorAll('section.note-item')).map(el => {
      const linkEl = el.querySelector('a')
      const href = linkEl ? linkEl.getAttribute('href') : ''
      const title = el.querySelector('.title span')?.innerText
        || el.querySelector('a.title')?.innerText || ''
      const likes = el.querySelector('.like-wrapper .count')?.innerText || '0'
      const author = el.querySelector('.author-wrapper .name')?.innerText
        || el.querySelector('.nickname')?.innerText || ''
      return {
        title: title.trim(),
        likes: likes.trim(),
        comments: '0',
        collects: '0',
        author: author.trim(),
        note_id: href ? href.split('/').pop()?.split('?')[0] || '' : ''
      }
    }).filter(item => item.title.length > 0)
  }
}
