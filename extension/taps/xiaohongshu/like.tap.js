export default {
  site: "xiaohongshu",
  name: "like",
  description: "点赞当前笔记",
  columns: ["status"],
  args: {},

  async run(page) {
    // Check if already liked via SSR state
    const already = await page.eval(() => {
      const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {}
      for (const [k, v] of Object.entries(map)) {
        if (!k || k === "undefined") continue
        return !!(v?.note?.interactInfo?.liked)
      }
      return false
    })

    if (already) {
      return [{ status: "already_liked" }]
    }

    // Click the like button (heart icon in note detail)
    await page.click('[name="like-active"], .like-wrapper .like-icon, span.like-wrapper')
    await page.wait(1500)

    // Verify liked state
    const liked = await page.eval(() => {
      const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {}
      for (const [k, v] of Object.entries(map)) {
        if (!k || k === "undefined") continue
        return !!(v?.note?.interactInfo?.liked)
      }
      // Fallback: check DOM for active like state
      const active = document.querySelector('[name="like-active"][color="red"], .like-wrapper.active, .like-active')
      return !!active
    })

    return [{ status: liked ? "liked" : "failed" }]
  }
}
