export default {
  site: "xiaohongshu",
  name: "follow",
  description: "关注当前笔记的作者",
  columns: ["status", "user"],
  args: {},

  async run(page) {
    // Extract author name and follow state from SSR state
    const info = await page.eval(() => {
      const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {}
      for (const [k, v] of Object.entries(map)) {
        if (!k || k === "undefined" || k === "") continue
        const note = v?.note || {}
        const user = note.user || {}
        return {
          nickname: user.nickname || "",
          followed: !!user.followed
        }
      }
      return null
    })

    if (!info || !info.nickname) {
      return [{ status: "error", user: "no note open — call open first" }]
    }

    if (info.followed) {
      return [{ status: "already_followed", user: info.nickname }]
    }

    // Click the follow button in the note detail
    await page.click("关注")
    await page.wait(2000)

    // Verify follow state changed
    const after = await page.eval(() => {
      const map = window.__INITIAL_STATE__?.note?.noteDetailMap || {}
      for (const [k, v] of Object.entries(map)) {
        if (!k || k === "undefined" || k === "") continue
        return !!(v?.note?.user?.followed)
      }
      return false
    })

    return [{
      status: after ? "followed" : "clicked",
      user: info.nickname
    }]
  }
}
