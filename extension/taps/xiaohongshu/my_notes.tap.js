export default {
  site: "xiaohongshu",
  name: "my_notes",
  description: "读取自己发布的笔记列表及互动数据",
  url: "https://creator.xiaohongshu.com/creator/content/manage",
  health: { min_rows: 1, non_empty: ["title"] },

  extract: async () => {
    // API first: creator content management endpoint
    try {
      const res = await fetch(
        'https://creator.xiaohongshu.com/api/galaxy/creator/note/user/posted?page=1&page_size=30',
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }
      )
      if (res.ok) {
        const data = await res.json()
        const notes = data?.data?.note_list || data?.data?.notes || data?.data?.list || []
        if (Array.isArray(notes) && notes.length > 0) {
          return notes.map(note => ({
            title: String(note.title || note.display_title || note.displayTitle || ''),
            likes: String(note.liked_count ?? note.likedCount ?? note.like_count ?? note.likeCount ?? 0),
            collects: String(note.collected_count ?? note.collectedCount ?? note.collect_count ?? note.collectCount ?? 0),
            comments: String(note.comment_count ?? note.commentCount ?? note.comments_count ?? note.commentsCount ?? 0),
            publish_date: String(note.publish_time ?? note.publishTime ?? note.time ?? note.create_time ?? note.createTime ?? '')
          })).filter(item => item.title.length > 0)
        }
      }
    } catch (e) { /* fall through to DOM */ }

    // DOM fallback: extract from content management table
    const rows = document.querySelectorAll(
      '.content-item, .note-item, [class*="noteItem"], [class*="content-card"], table tbody tr, .manage-list .item'
    )
    if (rows.length > 0) {
      return Array.from(rows).map(row => {
        const title = row.querySelector(
          '.title, [class*="title"], .note-title, a[class*="name"], .name'
        )?.textContent?.trim() || ''
        const stats = row.querySelectorAll(
          '.count, .num, [class*="count"], [class*="num"], [class*="data"] span, td'
        )
        const statValues = Array.from(stats).map(el => el.textContent?.trim() || '0')
        const dateEl = row.querySelector(
          '.date, .time, [class*="date"], [class*="time"], time'
        )
        return {
          title,
          likes: statValues[0] || '0',
          collects: statValues[1] || '0',
          comments: statValues[2] || '0',
          publish_date: dateEl?.textContent?.trim() || ''
        }
      }).filter(item => item.title.length > 0)
    }

    // Broadest fallback: labeled stat pairs
    const noteEls = document.querySelectorAll('[class*="note"], [class*="content"], [class*="card"]')
    return Array.from(noteEls).map(el => {
      const title = el.querySelector('[class*="title"], .title, a')?.textContent?.trim() || ''
      if (!title || title.length > 200) return null
      const getText = (keywords) => {
        for (const child of el.querySelectorAll('span, div, td, p')) {
          const t = child.textContent?.trim() || ''
          for (const kw of keywords) {
            if (t.includes(kw)) {
              const numMatch = t.match(/[\d,.]+[万]?/)
              return numMatch ? numMatch[0] : '0'
            }
          }
        }
        return '0'
      }
      return {
        title,
        likes: getText(['赞', 'like']),
        collects: getText(['收藏', 'collect']),
        comments: getText(['评论', 'comment']),
        publish_date: getText(['发布', '时间', 'date'])
      }
    }).filter(Boolean).filter(item => item.title.length > 0)
  }
}
