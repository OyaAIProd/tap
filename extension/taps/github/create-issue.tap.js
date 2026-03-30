export default {
  site: "github",
  name: "create-issue",
  description: "Create a GitHub issue via API",
  columns: ["status", "url"],
  args: {
    repo: { type: "string" },
    title: { type: "string" },
    body: { type: "string", default: "" },
    labels: { type: "string", default: "" }
  },

  async run(page, args) {
    if (!args.repo || !args.title) {
      return [{ status: "error", url: "missing repo or title" }]
    }

    const result = await page.eval(async (a) => {
      const labelsArr = a.labels ? a.labels.split(",").map(l => l.trim()).filter(Boolean) : []
      const res = await fetch(`https://api.github.com/repos/${a.repo}/issues`, {
        method: "POST",
        headers: {
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          title: a.title,
          body: a.body || "",
          labels: labelsArr
        })
      })
      const data = await res.json()
      if (data.html_url) {
        return { status: "created", url: data.html_url }
      }
      return { status: "error", url: data.message || "failed" }
    }, args)

    return [result]
  }
}
