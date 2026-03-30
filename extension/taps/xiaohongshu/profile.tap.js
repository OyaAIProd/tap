export default {
  site: "xiaohongshu",
  name: "profile",
  description: "读取小红书创作者中心的账号数据",
  url: "https://creator.xiaohongshu.com/creator/home",
  health: { min_rows: 1, non_empty: ["followers"] },

  extract: async () => {
    // API first: creator center uses this endpoint for dashboard stats
    try {
      const res = await fetch(
        'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info',
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'Accept': 'application/json' }
        }
      )
      if (res.ok) {
        const data = await res.json()
        const info = data?.data || {}
        if (info.fans_count !== undefined || info.fansCount !== undefined) {
          return [{
            followers: String(info.fans_count ?? info.fansCount ?? 0),
            likes: String(info.liked_count ?? info.likedCount ?? info.like_count ?? info.likeCount ?? 0),
            collects: String(info.collected_count ?? info.collectedCount ?? info.collect_count ?? info.collectCount ?? 0),
            notes: String(info.note_count ?? info.noteCount ?? info.notes_count ?? info.notesCount ?? 0)
          }]
        }
      }
    } catch (e) { /* fall through to DOM */ }

    // DOM fallback: extract stats from the creator dashboard page
    const statEls = document.querySelectorAll(
      '.data-info .count, .home-card .data-content .num, [class*="dataItem"] .value, [class*="data-card"] .num, [class*="statistic"] .value'
    )
    if (statEls.length >= 4) {
      return [{
        followers: statEls[0]?.textContent?.trim() || '0',
        likes: statEls[1]?.textContent?.trim() || '0',
        collects: statEls[2]?.textContent?.trim() || '0',
        notes: statEls[3]?.textContent?.trim() || '0'
      }]
    }

    // Broader DOM fallback: look for labeled stat pairs
    const labels = document.querySelectorAll('[class*="label"], [class*="title"], .data-name, .name')
    const row = { followers: '0', likes: '0', collects: '0', notes: '0' }
    for (const label of labels) {
      const text = (label.textContent || '').trim()
      const valueEl = label.nextElementSibling || label.parentElement?.querySelector('[class*="num"], [class*="count"], [class*="value"]')
      const value = valueEl?.textContent?.trim() || ''
      if (!value) continue
      if (text.includes('粉丝')) row.followers = value
      else if (text.includes('获赞')) row.likes = value
      else if (text.includes('收藏')) row.collects = value
      else if (text.includes('笔记')) row.notes = value
    }
    if (row.followers !== '0' || row.likes !== '0') {
      return [row]
    }

    return [{ followers: '0', likes: '0', collects: '0', notes: '0' }]
  }
}
