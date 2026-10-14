import { tool } from '@strands-agents/sdk'
import z from 'zod'

/**
 * Get current weather using wttr.in (free, no API key needed).
 */
export const weather = tool({
  name: 'weather',
  description: 'Get the current weather for a location. Returns temperature, conditions, humidity, and wind.',
  inputSchema: z.object({
    location: z.string().describe('City or location name, e.g. "Hong Kong", "Tokyo", "London"'),
  }),
  callback: async (input) => {
    const { location } = input
    console.log(`\n🌤️ [weather] Location: "${location}"`)

    try {
      const url = `https://wttr.in/${encodeURIComponent(location)}?format=j1`
      const response = await fetch(url, {
        headers: { 'User-Agent': 'curl/7.68.0' },
      })
      const data = await response.json() as {
        current_condition: Array<{
          temp_C: string
          humidity: string
          weatherDesc: Array<{ value: string }>
          FeelsLikeC: string
          windspeedKmph: string
        }>
      }

      if (data.current_condition?.[0]) {
        const c = data.current_condition[0]
        const result = `${location}: ${c.temp_C}°C (feels like ${c.FeelsLikeC}°C), ${c.weatherDesc[0]?.value}, humidity ${c.humidity}%, wind ${c.windspeedKmph} km/h`
        console.log(`🌤️ [weather] ${result}`)
        return result
      }
      return `Could not get weather for "${location}".`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return `Weather lookup failed: ${errMsg}`
    }
  },
})
