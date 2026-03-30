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

    // JS click — text search avoids CDP detach
    await page.eval(() => {
      const el = Array.from(document.querySelectorAll('*'))
        .find(e => e.children.length === 0 && e.innerText?.trim() === '关注')
      el?.click()
    })
    await page.wait(1500)

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
