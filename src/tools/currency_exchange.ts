import { tool } from '@strands-agents/sdk'
import z from 'zod'

export const get_exchange_rate = tool({
  name: 'get_exchange_rate',
  description: 'Get the current exchange rate between two currencies (e.g., USD to HKD).',
  inputSchema: z.object({
    base_currency: z.string().describe('The base currency code (e.g., USD, EUR, GBP)'),
    target_currency: z.string().describe('The target currency code (e.g., HKD, JPY, CAD)'),
  }),
  callback: async (input) => {
    const { base_currency, target_currency } = input
    console.log(`🔍 Fetching exchange rate from ${base_currency} to ${target_currency}...`)

    try {
      const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${base_currency.toUpperCase()}`)
      if (!response.ok) {
        return `Error: Could not fetch data for ${base_currency}. Please check the currency code.`
      }
      
      const data = await response.json()
      const rate = data.rates[target_currency.toUpperCase()]

      if (!rate) {
        return `Error: Target currency ${target_currency} not found in the response.`
      }

      console.log(`✅ Successfully retrieved rate: 1 ${base_currency} = ${rate} ${target_currency}`)
      return `The current exchange rate from ${base_currency} to ${target_currency} is ${rate}.`
    } catch (error) {
      console.error(`❌ Error fetching exchange rate:`, error)
      return `Error: An unexpected error occurred while fetching the exchange rate.`
    }
  },
})
