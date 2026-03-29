export default {
  site: "wechat",
  name: "detail",
  description: "读取当前已打开的微信公众号文章详情（标题、正文、作者、日期）",
  columns: ["type", "content", "author", "date"],
  args: {},
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page) {
    const items = await page.eval(() => {
      const results = []

      const title = (document.querySelector('#activity-name')?.innerText || '').trim()
      const author = (document.querySelector('#js_name, .rich_media_meta_nickname')?.innerText || '').trim()
      const body = (document.querySelector('#js_content')?.innerText || '').trim()
      const date = (document.querySelector('#publish_time, .rich_media_meta_date')?.innerText || '').trim()
      const account = (document.querySelector('.profile_nickname, #js_name')?.innerText || '').trim()

      if (title || body) {
        results.push({
          type: "article",
          content: (title + "\n" + body).substring(0, 2000),
          author: author,
          date: date
        })
      }

      if (account || date) {
        results.push({
          type: "meta",
          content: "account:" + account,
          author: account,
          date: date
        })
      }

      if (results.length === 0) {
        results.push({
          type: "info",
          content: "no article content found — call open first",
          author: "",
          date: ""
        })
      }

      return results
    })

    return items
  }
}
