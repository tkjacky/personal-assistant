import { tool } from '@strands-agents/sdk'
import { ChromaClient } from 'chromadb'
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed'
import z from 'zod'

const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost'
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8100')
const COLLECTION_NAME = 'memories'

const client = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT })
const embeddingFunction = new DefaultEmbeddingFunction()

async function getCollection() {
  return client.getOrCreateCollection({ name: COLLECTION_NAME, embeddingFunction })
}

/**
 * Store a memory in ChromaDB.
 */
export const remember = tool({
  name: 'remember',
  description: 'Save important information to long-term memory. Use this when the user asks you to remember something, or when you encounter important facts about the user (name, preferences, important dates, etc.).',
  inputSchema: z.object({
    content: z.string().describe('The information to remember, in English'),
    category: z.string().optional().describe('Category tag, e.g. "preference", "fact", "event", "person"'),
  }),
  callback: async (input) => {
    const { content, category } = input
    console.log(`\n🧠 [remember] Storing: "${content}"`)

    try {
      const collection = await getCollection()
      const id = `mem_${Date.now()}`
      const metadata: Record<string, string> = {
        timestamp: new Date().toISOString(),
      }
      if (category) metadata.category = category

      await collection.add({
        ids: [id],
        documents: [content],
        metadatas: [metadata],
      })

      console.log(`🧠 [remember] Stored with id: ${id}`)
      return `Remembered: "${content}"`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🧠 [remember] Error: ${errMsg}`)
      return `Failed to remember: ${errMsg}`
    }
  },
})

/**
 * Recall memories from ChromaDB by semantic search.
 */
export const recall = tool({
  name: 'recall',
  description: 'Search long-term memory for relevant information. Use this when the user asks about something you might have been told before, or when you need context about the user.',
  inputSchema: z.object({
    query: z.string().describe('What to search for in memory, in English'),
    limit: z.number().optional().describe('Max results to return (default 5)'),
  }),
  callback: async (input) => {
    const { query, limit = 5 } = input
    console.log(`\n🧠 [recall] Searching: "${query}"`)

    try {
      const collection = await getCollection()
      const results = await collection.query({
        queryTexts: [query],
        nResults: limit,
      })

      if (!results.documents?.[0]?.length) {
        console.log(`🧠 [recall] No memories found`)
        return 'No relevant memories found.'
      }

      let output = 'Memories found:\n'
      for (let i = 0; i < results.documents[0].length; i++) {
        const doc = results.documents[0][i]
        const id = results.ids?.[0]?.[i] || 'unknown'
        const meta = results.metadatas?.[0]?.[i] as Record<string, string> | undefined
        const timestamp = meta?.timestamp || 'unknown'
        const category = meta?.category || ''
        output += `- [id:${id}] [${timestamp}]${category ? ` (${category})` : ''}: ${doc}\n`
      }

      console.log(`🧠 [recall] Found ${results.documents[0].length} memories`)
      return output
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🧠 [recall] Error: ${errMsg}`)
      return `Failed to recall: ${errMsg}`
    }
  },
})


/**
 * Forget (delete) a memory from ChromaDB.
 */
export const forget = tool({
  name: 'forget',
  description: 'Delete a memory from long-term memory. Use ONLY after the user confirms they want to delete it. Always confirm with the user before calling this tool.',
  inputSchema: z.object({
    memoryId: z.string().describe('The memory ID to delete (from recall results, e.g. "mem_1783420545072")'),
  }),
  callback: async (input) => {
    const { memoryId } = input
    console.log(`\n🧠 [forget] Deleting: ${memoryId}`)

    try {
      const collection = await getCollection()
      await collection.delete({ ids: [memoryId] })
      console.log(`🧠 [forget] Deleted: ${memoryId}`)
      return `Memory deleted: ${memoryId}`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🧠 [forget] Error: ${errMsg}`)
      return `Failed to delete memory: ${errMsg}`
    }
  },
})
