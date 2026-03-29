export default {
  site: "coingecko",
  name: "top",
  description: "Top cryptocurrencies by market cap",
  url: "https://www.coingecko.com",
  health: { min_rows: 5, non_empty: ["name", "symbol"] },

  extract: async () => {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50')
    const data = await res.json()
    return data.map(c => ({
      name: c.name,
      symbol: c.symbol.toUpperCase(),
      price: '$' + (c.current_price || 0).toLocaleString(),
      change_24h: (c.price_change_percentage_24h >= 0 ? '+' : '') + (c.price_change_percentage_24h || 0).toFixed(2) + '%'
    }))
  }
}
