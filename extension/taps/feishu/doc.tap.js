export default {
  site: "feishu",
  name: "doc",
  description: "读取当前已打开的飞书文档全文（block_map直接提取 + TOC懒加载兜底）",
  columns: ["type", "content", "level"],
  args: {},
  health: { min_rows: 5, non_empty: ["content"] },

  async run(page) {
    const items = await page.eval(async () => {
      // Step 1: 从 block_map 直接提取已加载的块（最优雅路径）
      const blockMap = window.DATA?.clientVars?.data?.block_map || {}
      const hasMore = window.DATA?.clientVars?.data?.has_more

      function extractBlock(blockId) {
        const block = blockMap[blockId]
        if (!block) return []
        const d = block.data
        const type = d?.type || "text"

        let text = ""
        if (d?.text?.initialAttributedTexts?.text) {
          text = Object.values(d.text.initialAttributedTexts.text).join("").trim()
        }

        const rows = []
        if (text) {
          const level = type === "heading1" ? "1"
            : type === "heading2" ? "2"
            : type === "heading3" ? "3"
            : type === "bullet" ? "bullet"
            : type === "quote" ? "quote"
            : "0"
          rows.push({ type, content: text, level })
        } else if (type === "divider") {
          rows.push({ type: "divider", content: "---", level: "0" })
        }

        for (const childId of (d?.children || [])) {
          rows.push(...extractBlock(childId))
        }
        return rows
      }

      const rootId = Object.keys(blockMap).find(id => !blockMap[id].data?.parent_id)
      const fromBlockMap = rootId ? extractBlock(rootId) : []

      // Step 2: 如果文档有懒加载内容（has_more），点击 TOC 触发渲染
      if (!hasMore && fromBlockMap.length > 5) return fromBlockMap

      const extraLines = new Set(fromBlockMap.map(r => r.content))
      const mainEl = Array.from(document.querySelectorAll("*"))
        .find(el => el.scrollHeight > 5000 && el.clientHeight > 0)

      if (mainEl) {
        // MutationObserver 收集懒渲染的文本行
        const observer = new MutationObserver(() => {
          mainEl.innerText.trim().split("\n").forEach(l => {
            const t = l.trim()
            if (t.length > 10) extraLines.add(t)
          })
        })
        observer.observe(mainEl, { childList: true, subtree: true, characterData: true })

        // 点击所有 TOC 链接，触发各节懒加载
        const tocLinks = Array.from(document.querySelectorAll("a.container.catalogue__item-title"))
        for (let i = 0; i < tocLinks.length; i++) {
          tocLinks[i].click()
          await new Promise(r => setTimeout(r, 250))
        }

        await new Promise(r => setTimeout(r, 1500))
        observer.disconnect()
      }

      // 合并：block_map 结构化内容 + observer 补全的行
      if (fromBlockMap.length > 5) {
        const blockContent = new Set(fromBlockMap.map(r => r.content))
        for (const line of extraLines) {
          if (!blockContent.has(line)) {
            fromBlockMap.push({ type: "text", content: line, level: "0" })
          }
        }
        return fromBlockMap
      }

      // 纯 fallback：observer 文本
      return [...extraLines]
        .filter(t => t.length > 5)
        .map(t => ({ type: "text", content: t, level: "0" }))
    })

    return items
  }
}
