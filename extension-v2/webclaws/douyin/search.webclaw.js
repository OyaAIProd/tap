export default {
  site: "douyin",
  name: "search",
  description: "搜索抖音视频，返回标题+点赞数+作者",
  url: "https://www.douyin.com",
  args: { keyword: { type: "string" } },
  health: { min_rows: 3, non_empty: ["title"] },

  extract: async (args) => {
    try {
      const params = new URLSearchParams({
        search_channel: 'aweme_general',
        keyword: args.keyword,
        count: '20',
        offset: '0',
        need_filter_settings: '1',
        device_platform: 'webapp',
        aid: '6383'
      })
      const res = await fetch(
        'https://www.douyin.com/aweme/v1/web/general/search/single/?' + params.toString(),
        { credentials: 'include' }
      )
      const data = await res.json()
      if (data.data) {
        return data.data
          .filter(item => item.aweme_info)
          .map(item => {
            const info = item.aweme_info
            const stats = info.statistics || {}
            return {
              title: info.desc || '',
              likes: String(stats.digg_count || 0),
              author: info.author?.nickname || '',
              url: 'https://www.douyin.com/video/' + (info.aweme_id || '')
            }
          })
      }
      return [{ title: 'API requires login — visit douyin.com first', likes: '0', author: '', url: '' }]
    } catch (e) {
      return [{ title: 'Error: ' + e.message, likes: '0', author: '', url: '' }]
    }
  }
}
