export default {
  site: "dictionary",
  name: "search",
  description: "English dictionary lookup (Free Dictionary API)",
  url: "https://dictionaryapi.dev",
  args: { word: { type: "string" } },
  health: { min_rows: 1, non_empty: ["word", "definition"] },

  extract: async (args) => {
    const res = await fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(args.word), { credentials: 'include' })
    if (!res.ok) return [{ word: args.word, partOfSpeech: '-', definition: 'Not found', example: '-' }]
    const data = await res.json()
    const results = []
    for (const entry of data) {
      for (const m of entry.meanings) {
        for (const d of m.definitions.slice(0, 2)) {
          results.push({
            word: String(entry.word),
            partOfSpeech: String(m.partOfSpeech),
            definition: String(d.definition),
            example: String(d.example || '-')
          })
        }
      }
    }
    return results
  }
}
