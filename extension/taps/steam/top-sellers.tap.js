export default {
  site: "steam",
  name: "top-sellers",
  description: "Steam top selling games",
  url: "https://store.steampowered.com",

  extract: async () => {
    const res = await fetch('https://store.steampowered.com/api/featuredcategories?cc=us&l=english')
    const data = await res.json()
    return (data.top_sellers.items || []).map((g, i) => ({
      rank: String(i + 1),
      title: String(g.name),
      price: g.final_price ? '$' + (g.final_price / 100).toFixed(2) : 'Free',
      discount: g.discount_percent ? g.discount_percent + '% off' : '-'
    }))
  }
}
