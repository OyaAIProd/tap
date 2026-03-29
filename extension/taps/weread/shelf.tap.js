export default {
  site: "weread",
  name: "shelf",
  description: "微信读书书架（需登录）",
  url: "https://weread.qq.com/web/shelf",
  health: { min_rows: 1, non_empty: ["title"] },

  extract: async () => {
    try {
      const res = await fetch(
        'https://weread.qq.com/api/shelf/sync',
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }
      )
      const data = await res.json()
      const books = data.bookInfos || data.books || []
      if (Array.isArray(books) && books.length > 0) {
        return books.map((item, i) => {
          const book = item.bookInfo || item
          return {
            rank: String(i + 1),
            title: book.title || '',
            author: book.author || '',
            cover: book.cover || '',
            category: book.category || '',
            readProgress: String(item.readingProgress || item.progress || 0) + '%',
            url: 'https://weread.qq.com/web/reader/' + (book.bookId || '')
          }
        }).filter(item => item.title.length > 0)
      }
    } catch (e) { /* fall through to DOM */ }

    // DOM fallback
    return Array.from(document.querySelectorAll('.shelf_list li, .book_item, [class*="bookItem"]')).map((el, i) => {
      const title = el.querySelector('.book_title, [class*="title"]')?.textContent?.trim() || ''
      const author = el.querySelector('.book_author, [class*="author"]')?.textContent?.trim() || ''
      const linkEl = el.querySelector('a[href*="reader"]')
      const url = linkEl ? linkEl.href : ''
      return {
        rank: String(i + 1),
        title,
        author,
        cover: '',
        category: '',
        readProgress: '',
        url
      }
    }).filter(item => item.title.length > 0)
  }
}
