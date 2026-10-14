import { tool } from '@strands-agents/sdk'
import z from 'zod'
import { ChromaClient } from 'chromadb'
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed'

const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost'
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8100')

const chromaClient = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT })
const embeddingFunction = new DefaultEmbeddingFunction()

const COLLECTION_NAME = 'identity'
const DOC_ID = 'assistant_identity'

async function getCollection() {
  return chromaClient.getOrCreateCollection({ name: COLLECTION_NAME, embeddingFunction })
}

/**
 * Set assistant's own identity property.
 */
export const setIdentity = tool({
  name: 'set_identity',
  description: 'Set your own identity property (e.g. name, personality). Use when the user gives you a name or tells you something about yourself.',
  inputSchema: z.object({
    key: z.string().describe('The property to set, e.g. "name", "personality", "role"'),
    value: z.string().describe('The value to set'),
  }),
  callback: async (input) => {
    const { key, value } = input
    console.log(`\n🪪 [set_identity] Setting ${key} = "${value}"`)

    try {
      const collection = await getCollection()

      // Get existing identity
      let existing: Record<string, string> = {}
      try {
        const result = await collection.get({ ids: [DOC_ID] })
        if (result.metadatas?.[0]) {
          existing = result.metadatas[0] as Record<string, string>
        }
      } catch {}

      // Update property
      existing[key] = value

      // Build document text from all properties
      const docText = Object.entries(existing).map(([k, v]) => `${k}: ${v}`).join(', ')

      // Upsert
      try { await collection.delete({ ids: [DOC_ID] }) } catch {}
      await collection.add({
        ids: [DOC_ID],
        documents: [docText],
        metadatas: [existing],
      })

      console.log(`🪪 [set_identity] Saved`)
      return `Identity updated: ${key} = "${value}"`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🪪 [set_identity] Error: ${errMsg}`)
      return `Failed to set identity: ${errMsg}`
    }
  },
})

/**
 * Get assistant's own identity.
 */
export const getIdentity = tool({
  name: 'get_identity',
  description: 'Get your own identity info (name, personality, etc). Use when someone asks who you are or your name.',
  inputSchema: z.object({}),
  callback: async () => {
    console.log(`\n🪪 [get_identity] Getting identity`)

    try {
      const collection = await getCollection()
      const result = await collection.get({ ids: [DOC_ID] })

      if (!result.metadatas?.[0] || Object.keys(result.metadatas[0]).length === 0) {
        return 'No identity set yet. The user has not given me a name.'
      }

      const props = result.metadatas[0] as Record<string, string>
      const entries = Object.entries(props).map(([k, v]) => `${k}: ${v}`)

      console.log(`🪪 [get_identity] Found: ${entries.join(', ')}`)
      return `My identity:\n${entries.join('\n')}`
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🪪 [get_identity] Error: ${errMsg}`)
      return 'No identity set yet.'
    }
  },
})
