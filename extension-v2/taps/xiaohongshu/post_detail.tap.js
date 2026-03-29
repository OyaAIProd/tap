export default {
  site: "xiaohongshu",
  name: "post_detail",
  description: "搜索→点击→从弹窗SSR state提取帖子详情+评论内容",
  columns: ["type", "content", "likes", "author"],
  args: {
    keyword: { type: "string" },
    index: { type: "int", default: 1 }
  },
  health: { min_rows: 1, non_empty: ["content"] },

  async run(page, args) {
    // Compose: open note → read detail
    await page.tap("xiaohongshu", "open", { keyword: args.keyword, index: args.index })
    return await page.tap("xiaohongshu", "detail")
  }
}
