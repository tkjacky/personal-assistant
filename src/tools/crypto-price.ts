import { tool } from '@strands-agents/sdk'
import z from 'zod'

/**
 * Get cryptocurrency prices from CoinGecko (free, no API key needed).
 */
export const cryptoPrice = tool({
  name: 'crypto_price',
  description: 'Get the current price of a cryptocurrency (e.g. bitcoin, ethereum, solana). Returns price in USD and HKD with 24h change.',
  inputSchema: z.object({
    coin: z.string().describe('Coin ID, e.g. "bitcoin", "ethereum", "solana", "dogecoin"'),
  }),
  callback: async (input) => {
    const { coin } = input
    const coinId = coin.toLowerCase().trim()
    console.log(`\n💰 [crypto_price] Coin: "${coinId}"`)

    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd,hkd&include_24hr_change=true`
      const response = await fetch(url)
      const data = await response.json() as Record<string, { usd: number; hkd: number; usd_24h_change?: number }>

      if (data[coinId]) {
        const c = data[coinId]
        const change = c.usd_24h_change ? `${c.usd_24h_change.toFixed(2)}%` : 'N/A'
        const result = `${coinId}: USD $${c.usd.toLocaleString()} | HKD $${c.hkd.toLocaleString()} | 24h: ${change}`
        console.log(`💰 [crypto_price] ${result}`)
        return result
      }
      return `Coin "${coinId}" not found. Try: bitcoin, ethereum, solana, dogecoin, ripple`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return `Failed to get price: ${errMsg}`
    }
  },
})
