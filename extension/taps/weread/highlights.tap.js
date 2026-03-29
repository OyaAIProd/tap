export default {
  site: "weread",
  name: "highlights",
  description: "微信读书划线笔记（需登录）",
  url: "https://weread.qq.com/web/shelf",
  args: { bookId: { type: "string" } },
  health: { min_rows: 1, non_empty: ["text"] },

  extract: async (args) => {
    try {
      const res = await fetch(
        'https://weread.qq.com/api/book/bookmarklist?bookId=' + encodeURIComponent(args.bookId),
        {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }
      )
      const data = await res.json()
      const marks = data.updated || data.bookmarks || []
      if (Array.isArray(marks) && marks.length > 0) {
        return marks.map((item, i) => ({
          rank: String(i + 1),
          text: item.markText || '',
          chapter: item.chapterName || '',
          createTime: item.createTime ? new Date(item.createTime * 1000).toISOString().split('T')[0] : '',
          style: String(item.style || 0)
        }))
      }
    } catch (e) { /* fall through */ }

    // Try reviews/thoughts API as fallback
    try {
      const res = await fetch(
        'https://weread.qq.com/api/review/list?bookId=' + encodeURIComponent(args.bookId) + '&listType=11&mine=1',
        {
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }
      )
      const data = await res.json()
      const reviews = data.reviews || []
      return reviews.map((item, i) => ({
        rank: String(i + 1),
        text: item.review?.content || '',
        chapter: item.review?.chapterName || '',
        createTime: item.review?.createTime ? new Date(item.review.createTime * 1000).toISOString().split('T')[0] : '',
        style: 'thought'
      }))
    } catch (e) {
      return [{ text: 'Error: login required — visit weread.qq.com first', chapter: '', createTime: '', style: '' }]
    }
  }
}
