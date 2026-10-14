import { Agent, BeforeToolCallEvent, SessionManager, FileStorage, SummarizingConversationManager } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'
import { toolWriterTool, setMainAgentRef } from './tool-writer.js'
import { detectSensitiveData } from '../guardrail.js'
import { loadTools } from '../tool-loader.js'
import { wrapToolsWithResilience } from '../tool-resilience.js'

// Docker Model Runner exposes an OpenAI-compatible API.
const DMR_BASE_URL = process.env.DMR_BASE_URL || 'http://localhost:12434/v1'

// Your local Gemma 4 12B model pulled into DMR
// Run: docker model pull huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf
const DMR_MODEL_ID = process.env.DMR_MODEL_ID || 'huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf'

const WEB_SEARCH_ENABLED = process.env.WEB_SEARCH_ENABLED !== 'false'

import toolsConfig from '../tools-config.json' with { type: 'json' }

// Build tools list for system prompt from config
const toolsList = toolsConfig.map(t => `- ${t.name}: ${t.description}`).join('\n')

const SYSTEM_PROMPT = `You are a helpful personal assistant. Always respond in Cantonese. Keep your responses concise and to the point.

Your user's name is ${process.env.USER_NAME || 'User'}. They are located at ${process.env.USER_LOCATION || 'Hong Kong'}.
To know your own name and identity, use get_identity. When the user gives you a name, use set_identity to store it.

You have access to these tools:
${toolsList}

IMPORTANT: Always use the appropriate tool when the user asks about real-time information. Use crypto_price for crypto/coin prices, weather for weather, tv_control for TV commands, and web_search for everything else. Never guess — use a tool first.
IMPORTANT: When the user gives you a name or tells you something about yourself, use set_identity. When someone asks who you are, use get_identity first.
IMPORTANT: When the user mentions people they know (by name or relationship), use save_person. When asking about a person, use find_person or search_people.
IMPORTANT: For person-related preference requests (likes/loves/favorite drink/food/gift), do a two-step lookup before asking the user: (1) resolve person identity with find_person if needed (e.g. relation like wife), then (2) call search_people with the resolved name to retrieve profile/preferences.
IMPORTANT: Do not ask the user for a person's preference until after you have attempted both find_person and search_people for that person.
IMPORTANT: Use remember/recall ONLY for general facts NOT about people (e.g. "my wifi password is...", "my car plate is..."). For anything about people, use the people tools instead.
IMPORTANT: Never send sensitive personal data (passwords, credit cards, ID numbers, phone numbers, emails) to any tool.
IMPORTANT: If you encounter a problem that could potentially be solved by a new tool, use tool_writer_agent to create one. Be proactive — if a capability is missing, build it.
IMPORTANT: Before using the forget or remove_person tool, ALWAYS confirm with the user first.`

// Create the model pointed at Docker Model Runner
const model = new OpenAIModel({
  api: 'chat',
  apiKey: 'dmr-local', // DMR doesn't require a real API key
  clientConfig: {
    baseURL: DMR_BASE_URL,
  },
  modelId: DMR_MODEL_ID,
  temperature: 1.0,
  maxTokens: 2048,
  contextWindowLimit: parseInt(process.env.CONTEXT_WINDOW_LIMIT || '32768'),
})

// Load all tools from tools-config.json
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tools: any[] = await loadTools()

// Add tool writer (not in tools folder, so loaded separately)
tools.push(toolWriterTool)

// Add web search conditionally
if (!WEB_SEARCH_ENABLED) {
  const idx = tools.findIndex((t: any) => t._functionTool?.name === 'web_search')
  if (idx >= 0) tools.splice(idx, 1)
}

// Apply timeout/retry/circuit-breaker resilience to all tools.
const resilientTools = wrapToolsWithResilience(tools)

console.log(`📦 Loaded ${resilientTools.length} tool(s): ${resilientTools.map((t: any) => t._functionTool?.name || t.name || 'unknown').join(', ')}`)

// Session persistence — saves conversation history to local files
const sessionManager = new SessionManager({
  sessionId: process.env.SESSION_ID || 'default',
  storage: { snapshot: new FileStorage('./sessions') },
})

// Conversation manager — summarizes old messages to stay within context window
const conversationManager = new SummarizingConversationManager({
  preserveRecentMessages: 50,
  summaryRatio: 0.5,
  proactiveCompression: { compressionThreshold: 0.7 },
})

// Create the Strands agent with the agent loop
const agent = new Agent({
  model,
  systemPrompt: SYSTEM_PROMPT,
  tools: resilientTools,
  sessionManager,
  conversationManager,
  printer: false, // We handle output rendering via the web UI
})

// Guardrail: Block tool calls containing sensitive data
agent.addHook(BeforeToolCallEvent, (event) => {
  const toolName = event.toolUse.name
  const input = event.toolUse.input

  const inputStr = typeof input === 'string' ? input : JSON.stringify(input)
  const detected = detectSensitiveData(inputStr)

  if (detected) {
    console.warn(`🛡️ [guardrail] BLOCKED tool "${toolName}": ${detected}`)
    event.cancel = `Blocked by guardrail: cannot send sensitive data to tools. ${detected}`
  }
})

// Set agent reference for hot-reload in tool writer
setMainAgentRef(agent)

export { agent }
