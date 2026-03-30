export default {
  site: "xiaohongshu",
  name: "notifications",
  description: "读取小红书通知（新粉丝、评论、点赞）",
  url: "https://creator.xiaohongshu.com/creator/message",
  health: { min_rows: 1, non_empty: ["type"] },

  extract: async () => {
    // API first: creator center message endpoints
    const rows = []

    // Fetch likes notifications
    try {
      const likesRes = await fetch(
        'https://creator.xiaohongshu.com/api/galaxy/creator/message/likes',
        { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }
      )
      if (likesRes.ok) {
        const data = await likesRes.json()
        const items = data?.data?.list || data?.data?.items || data?.data || []
        if (Array.isArray(items)) {
          for (const item of items) {
            rows.push({
              type: 'like',
              user: String(item.nickname || item.user_nickname || item.userName || item.user?.nickname || ''),
              content: String(item.content || item.note_title || item.noteTitle || item.title || ''),
              time: String(item.time || item.create_time || item.createTime || item.timestamp || '')
            })
          }
        }
      }
    } catch (e) { /* continue */ }

    // Fetch comments notifications
    try {
      const commentsRes = await fetch(
        'https://creator.xiaohongshu.com/api/galaxy/creator/message/comments',
        { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }
      )
      if (commentsRes.ok) {
        const data = await commentsRes.json()
        const items = data?.data?.list || data?.data?.items || data?.data || []
        if (Array.isArray(items)) {
          for (const item of items) {
            rows.push({
              type: 'comment',
              user: String(item.nickname || item.user_nickname || item.userName || item.user?.nickname || ''),
              content: String(item.content || item.comment_content || item.commentContent || ''),
              time: String(item.time || item.create_time || item.createTime || item.timestamp || '')
            })
          }
        }
      }
    } catch (e) { /* continue */ }

    // Fetch followers notifications
    try {
      const followRes = await fetch(
        'https://creator.xiaohongshu.com/api/galaxy/creator/message/follows',
        { method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' } }
      )
      if (followRes.ok) {
        const data = await followRes.json()
        const items = data?.data?.list || data?.data?.items || data?.data || []
        if (Array.isArray(items)) {
          for (const item of items) {
            rows.push({
              type: 'follower',
              user: String(item.nickname || item.user_nickname || item.userName || item.user?.nickname || ''),
              content: '关注了你',
              time: String(item.time || item.create_time || item.createTime || item.timestamp || '')
            })
          }
        }
      }
    } catch (e) { /* continue */ }

    if (rows.length > 0) return rows

    // DOM fallback: extract notifications from the message page
    const notifEls = document.querySelectorAll(
      '.message-item, .notice-item, [class*="message-list"] > div, [class*="notice"] li, [class*="msg-item"], [class*="notification"] > div'
    )
    for (const el of notifEls) {
      const text = (el.textContent || '').trim()
      if (!text || text.length < 2) continue

      let type = 'like'
      if (text.includes('关注') || text.includes('粉丝')) type = 'follower'
      else if (text.includes('评论') || text.includes('回复')) type = 'comment'
      else if (text.includes('赞') || text.includes('喜欢')) type = 'like'

      const userEl = el.querySelector('[class*="name"], [class*="user"], .nickname, a')
      const timeEl = el.querySelector('[class*="time"], [class*="date"], time')
      const contentEl = el.querySelector('[class*="content"], [class*="desc"], [class*="detail"], p')

      rows.push({
        type,
        user: userEl?.textContent?.trim() || '',
        content: contentEl?.textContent?.trim() || text.slice(0, 100),
        time: timeEl?.textContent?.trim() || ''
      })
    }

    return rows
  }
}
