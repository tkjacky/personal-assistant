import 'dotenv/config'
import crypto from 'crypto'

// Polyfill globalThis.crypto for Node.js < 19
if (!globalThis.crypto) {
  (globalThis as unknown as Record<string, unknown>).crypto = crypto
}

import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import { agent } from './agents/main.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, '../public')))

// Config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    audioEnabled: process.env.AUDIO_ENABLED !== 'false',
  })
})

// Context usage endpoint
app.get('/api/context-usage', (req, res) => {
  try {
    const messages = (agent as any).messages || []
    const contextLimit = parseInt(process.env.CONTEXT_WINDOW_LIMIT || '32768')

    // Try to get actual token count from the last assistant message's metadata
    let estimatedTokens = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      const usage = msg?.metadata?.usage
      if (usage && usage.inputTokens) {
        estimatedTokens = usage.inputTokens + usage.outputTokens
        break
      }
    }

    // Fallback: rough estimate if no usage metadata available
    if (estimatedTokens === 0) {
      const totalChars = JSON.stringify(messages).length
      estimatedTokens = Math.round(totalChars / 4)
    }

    const percentage = Math.min(100, Math.round((estimatedTokens / contextLimit) * 100))
    res.json({ percentage, tokens: estimatedTokens, limit: contextLimit })
  } catch {
    res.json({ percentage: 0, tokens: 0, limit: 32768 })
  }
})

// Chat endpoint (streaming via SSE, or JSON if ?stream=false)
app.post('/api/chat', async (req, res) => {
  const { message } = req.body
  if (!message) {
    res.status(400).json({ error: 'Message is required' })
    return
  }

  // Non-streaming mode for Siri Shortcuts and simple clients
  const streamMode = req.query.stream !== 'false'

  if (!streamMode) {
    try {
      const result = await agent.invoke(message)
      const lastMessage = result.lastMessage
      let text = ''
      if (lastMessage && lastMessage.content) {
        for (const block of lastMessage.content as unknown as Array<Record<string, unknown>>) {
          if ('text' in block && typeof block.text === 'string') {
            text += block.text
          }
        }
      }
      res.json({ response: text || 'No response.' })
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      res.status(500).json({ error: errMsg })
    }
    return
  }

  // Streaming mode (SSE) for web UI
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    for await (const event of agent.stream(message)) {
      if (event.type === 'modelStreamUpdateEvent') {
        const modelEvent = (event as any).event
        if (modelEvent?.type === 'modelContentBlockDeltaEvent') {
          const delta = modelEvent.delta
          if (delta?.type === 'textDelta' && delta.text) {
            res.write(`data: ${JSON.stringify({ type: 'text', content: delta.text })}\n\n`)
          }
        }
      }
    }
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    res.write(`data: ${JSON.stringify({ type: 'error', content: errMsg })}\n\n`)
    res.end()
  }
})

app.listen(PORT, () => {
  console.log(`🤖 Personal Assistant server running at http://localhost:${PORT}`)
  console.log(`   Model: ${process.env.DMR_MODEL_ID || 'huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf'}`)
  console.log(`   Press Ctrl+C to stop`)
})
