export default {
  site: "jimeng",
  name: "history",
  description: "即梦AI 查看最近生成的作品",
  url: "https://jimeng.jianying.com/ai-tool/home",

  extract: async () => {
    const res = await fetch('/mweb/v1/get_history?aid=513695&device_platform=web&region=cn', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cursor: '',
        count: 20,
        need_page_item: true,
        need_aigc_data: true,
        aigc_mode_list: ['workbench']
      })
    })
    const data = await res.json()
    const records = data?.data?.records_list || []
    const rows = []
    for (const rec of records) {
      const items = rec.item_list || []
      const created = new Date((rec.created_time || 0) * 1000).toLocaleString('zh-CN')
      for (const item of items) {
        const attr = item.common_attr || {}
        const urlMap = attr.cover_url_map || {}
        const url = urlMap['1080'] || urlMap['720'] || attr.cover_url || ''
        rows.push({
          prompt: attr.description || 'N/A',
          status: url ? 'completed' : 'pending',
          image_url: String(url),
          created_at: String(created)
        })
      }
    }
    return rows
  }
}
