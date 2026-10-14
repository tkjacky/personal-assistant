import { tool } from '@strands-agents/sdk'
import z from 'zod'
import neo4j from 'neo4j-driver'
import { ChromaClient } from 'chromadb'
import { DefaultEmbeddingFunction } from '@chroma-core/default-embed'

const NEO4J_URL = process.env.NEO4J_URL || 'bolt://localhost:7687'
const CHROMA_HOST = process.env.CHROMA_HOST || 'localhost'
const CHROMA_PORT = parseInt(process.env.CHROMA_PORT || '8100')

const neo4jDriver = neo4j.driver(NEO4J_URL, neo4j.auth.basic('neo4j', 'neo4j'))
const chromaClient = new ChromaClient({ host: CHROMA_HOST, port: CHROMA_PORT })
const embeddingFunction = new DefaultEmbeddingFunction()

async function getPeopleCollection() {
  return chromaClient.getOrCreateCollection({ name: 'people', embeddingFunction })
}

/**
 * Save a person: relationship in Neo4j, profile/preferences in ChromaDB.
 */
export const savePerson = tool({
  name: 'save_person',
  description: 'Save a person with their relationship and profile. Relationship stored in graph, profile/preferences stored for semantic search. Use when user mentions someone they know.',
  inputSchema: z.object({
    from: z.string().describe('The person who has the relationship (e.g. user\'s name)'),
    to: z.string().describe('The person being related to'),
    relationship: z.string().describe('The relationship type, e.g. "wife", "boss", "friend"'),
    notes: z.string().optional().describe('Profile info, preferences, or notes about the person'),
  }),
  callback: async (input) => {
    const { from, to, relationship, notes } = input
    console.log(`\n👤 [save_person] Saving: ${from} -[${relationship}]-> ${to}`)

    // Save relationship in Neo4j
    const session = neo4jDriver.session()
    try {
      await session.run(
        `MERGE (a:Person {name: $from})
         MERGE (b:Person {name: $to})
         MERGE (a)-[r:KNOWS {relationship: $relationship}]->(b)
         SET r.updated = datetime()`,
        { from, to, relationship }
      )
    } finally {
      await session.close()
    }

    // Save profile/notes in ChromaDB for semantic search
    if (notes) {
      const collection = await getPeopleCollection()
      const docId = `person_${to.toLowerCase().replace(/\s+/g, '_')}`
      const document = `${to} (${relationship} of ${from}): ${notes}`

      // Upsert: delete existing then add
      try { await collection.delete({ ids: [docId] }) } catch {}
      await collection.add({
        ids: [docId],
        documents: [document],
        metadatas: [{ name: to, relationship, relatedTo: from }],
      })
      console.log(`👤 [save_person] Profile saved to ChromaDB: ${docId}`)
    }

    console.log(`👤 [save_person] Done`)
    return `Saved: ${from} -[${relationship}]-> ${to}${notes ? `. Profile: ${notes}` : ''}`
  },
})

/**
 * Find people by name or relationship (Neo4j graph query).
 */
export const findPerson = tool({
  name: 'find_person',
  description: 'Search for a person by name or relationship in the knowledge graph.',
  inputSchema: z.object({
    query: z.string().describe('Name or relationship to search for, e.g. "Alex", "wife"'),
  }),
  callback: async (input) => {
    const { query } = input
    console.log(`\n👤 [find_person] Searching graph: "${query}"`)

    const session = neo4jDriver.session()
    try {
      const result = await session.run(
        `MATCH (a:Person)-[r:KNOWS]->(b:Person)
         WHERE toLower(a.name) CONTAINS toLower($query)
            OR toLower(b.name) CONTAINS toLower($query)
            OR toLower(r.relationship) CONTAINS toLower($query)
         RETURN a.name AS from, r.relationship AS relationship, b.name AS to`,
        { query }
      )

      if (result.records.length === 0) {
        return `No person found matching "${query}" in graph.`
      }

      let output = 'Relationships found:\n'
      for (const record of result.records) {
        output += `- ${record.get('from')} -[${record.get('relationship')}]-> ${record.get('to')}\n`
      }
      console.log(`👤 [find_person] Found ${result.records.length} results`)
      return output
    } finally {
      await session.close()
    }
  },
})

/**
 * Search people profiles semantically (ChromaDB).
 */
export const searchPeople = tool({
  name: 'search_people',
  description: 'Semantic search on people profiles and preferences. Use when looking for people by description, interests, or traits (e.g. "who likes hiking?", "someone who works in tech").',
  inputSchema: z.object({
    query: z.string().describe('What to search for, e.g. "likes hiking", "works at bank"'),
  }),
  callback: async (input) => {
    const { query } = input
    console.log(`\n👤 [search_people] Semantic search: "${query}"`)

    try {
      const collection = await getPeopleCollection()
      const results = await collection.query({ queryTexts: [query], nResults: 5 })

      if (!results.documents?.[0]?.length) {
        console.log(`👤 [search_people] No results`)
        return 'No matching people profiles found.'
      }

      let output = 'People matching your search:\n'
      for (let i = 0; i < results.documents[0].length; i++) {
        const doc = results.documents[0][i]
        output += `- ${doc}\n`
      }
      console.log(`👤 [search_people] Found ${results.documents[0].length} results`)
      return output
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      return `Search failed: ${errMsg}`
    }
  },
})

/**
 * List all people and relationships.
 */
export const listPeople = tool({
  name: 'list_people',
  description: 'List all people and relationships in the knowledge graph.',
  inputSchema: z.object({}),
  callback: async () => {
    console.log(`\n👤 [list_people] Listing all`)

    const session = neo4jDriver.session()
    try {
      const result = await session.run(
        `MATCH (a:Person)-[r:KNOWS]->(b:Person)
         RETURN a.name AS from, r.relationship AS relationship, b.name AS to
         ORDER BY a.name, r.relationship`
      )

      if (result.records.length === 0) return 'No people saved yet.'

      let output = 'People and relationships:\n'
      for (const record of result.records) {
        output += `- ${record.get('from')} -[${record.get('relationship')}]-> ${record.get('to')}\n`
      }
      return output
    } finally {
      await session.close()
    }
  },
})

/**
 * Update a person's profile/notes.
 */
export const updatePerson = tool({
  name: 'update_person',
  description: 'Update a person\'s profile notes or relationship. Use to change or clear notes.',
  inputSchema: z.object({
    name: z.string().describe('The person\'s name to update'),
    notes: z.string().optional().describe('New notes/profile (empty string to clear)'),
    relationship: z.string().optional().describe('New relationship value'),
  }),
  callback: async (input) => {
    const { name, notes, relationship } = input
    console.log(`\n👤 [update_person] Updating: ${name}`)

    // Update relationship in Neo4j
    if (relationship !== undefined) {
      const session = neo4jDriver.session()
      try {
        await session.run(
          `MATCH (a:Person)-[r:KNOWS]->(b:Person {name: $name})
           SET r.relationship = $relationship`,
          { name, relationship }
        )
      } finally {
        await session.close()
      }
    }

    // Update profile in ChromaDB
    if (notes !== undefined) {
      const collection = await getPeopleCollection()
      const docId = `person_${name.toLowerCase().replace(/\s+/g, '_')}`

      if (notes === '') {
        // Clear
        try { await collection.delete({ ids: [docId] }) } catch {}
      } else {
        // Upsert
        try { await collection.delete({ ids: [docId] }) } catch {}
        await collection.add({
          ids: [docId],
          documents: [notes],
          metadatas: [{ name }],
        })
      }
    }

    const updates = []
    if (notes !== undefined) updates.push(`notes = "${notes}"`)
    if (relationship !== undefined) updates.push(`relationship = "${relationship}"`)
    console.log(`👤 [update_person] Updated: ${updates.join(', ')}`)
    return `Updated ${name}: ${updates.join(', ')}`
  },
})

/**
 * Remove a person from both Neo4j and ChromaDB.
 */
export const removePerson = tool({
  name: 'remove_person',
  description: 'Remove a person from the knowledge graph and profile store. Always confirm with user first.',
  inputSchema: z.object({
    name: z.string().describe('The person\'s name to remove'),
  }),
  callback: async (input) => {
    const { name } = input
    console.log(`\n👤 [remove_person] Removing: ${name}`)

    // Remove from Neo4j
    const session = neo4jDriver.session()
    try {
      await session.run(
        `MATCH (p:Person {name: $name}) DETACH DELETE p`,
        { name }
      )
    } finally {
      await session.close()
    }

    // Remove from ChromaDB
    try {
      const collection = await getPeopleCollection()
      const docId = `person_${name.toLowerCase().replace(/\s+/g, '_')}`
      await collection.delete({ ids: [docId] })
    } catch {}

    console.log(`👤 [remove_person] Removed: ${name}`)
    return `Removed: ${name} from graph and profile store.`
  },
})
