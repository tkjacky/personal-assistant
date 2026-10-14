import { tool } from '@strands-agents/sdk'
import z from 'zod'

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''

/**
 * Generic web search tool using Tavily API.
 * Sign up for free at https://tavily.com (1,000 credits/month free).
 */
export const webSearch = tool({
  name: 'web_search',
  description: 'Search the web for current information. Use this for any question requiring up-to-date data: news, prices, events, facts, people, etc.',
  inputSchema: z.object({
    query: z.string().describe('The search query'),
  }),
  callback: async (input) => {
    const { query } = input
    console.log(`\n🔍 [web_search] Query: "${query}"`)

    if (!TAVILY_API_KEY) {
      const msg = 'TAVILY_API_KEY not set. Get a free key at https://tavily.com'
      console.log(`🔍 [web_search] Error: ${msg}`)
      return msg
    }

    try {
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'basic',
          max_results: 5,
          include_answer: true,
        }),
      })

      if (!response.ok) {
        const errText = await response.text()
        console.log(`🔍 [web_search] API Error: ${response.status} ${errText}`)
        return `Search failed: ${response.status}`
      }

      const data = await response.json() as {
        answer?: string
        results?: Array<{ title: string; url: string; content: string }>
      }

      let output = ''

      // Include the AI-generated answer if available
      if (data.answer) {
        output += `Answer: ${data.answer}\n\n`
      }

      // Include search results
      if (data.results && data.results.length > 0) {
        output += 'Sources:\n'
        for (const result of data.results) {
          output += `- ${result.title}: ${result.content.slice(0, 200)}\n  ${result.url}\n\n`
        }
      }

      if (!output) {
        output = `No results found for "${query}".`
      }

      console.log(`🔍 [web_search] Result:\n${output.slice(0, 500)}`)
      return output
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🔍 [web_search] Error: ${errMsg}`)
      return `Search failed: ${errMsg}`
    }
  },
})
