import { Agent, Graph } from '@strands-agents/sdk'
import { OpenAIModel } from '@strands-agents/sdk/models/openai'
import { tool } from '@strands-agents/sdk'
import z from 'zod'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { execSync } from 'child_process'

const DMR_BASE_URL = process.env.DMR_BASE_URL || 'http://localhost:12434/v1'
const DMR_MODEL_ID = process.env.DMR_MODEL_ID || 'huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf'
const TOOLS_DIR = path.resolve('./src/tools')
const WORKSPACE_DIR = path.resolve('./workspace')

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true })
}

// ===== Tools for Writer Node =====

const createToolFile = tool({
  name: 'create_tool_file',
  description: 'Write a TypeScript tool file to the workspace folder for testing.',
  inputSchema: z.object({
    filename: z.string().describe('The filename, e.g. "stock-price.ts"'),
    code: z.string().describe('The full TypeScript source code'),
  }),
  callback: (input) => {
    const safeName = path.basename(input.filename)
    if (!safeName.endsWith('.ts')) return 'Error: filename must end with .ts'
    const filePath = path.join(WORKSPACE_DIR, safeName)
    console.log(`\n🔧 [create_tool_file] Writing to workspace: ${safeName}`)
    fs.writeFileSync(filePath, input.code, 'utf-8')
    return `Tool file written to workspace: ${safeName}`
  },
})

const readToolFile = tool({
  name: 'read_tool_file',
  description: 'Read an existing tool file from src/tools/ for reference.',
  inputSchema: z.object({
    filename: z.string().describe('The filename to read, e.g. "weather.ts"'),
  }),
  callback: (input) => {
    const safeName = path.basename(input.filename)
    const filePath = path.join(TOOLS_DIR, safeName)
    console.log(`\n📖 [read_tool_file] Reading: ${safeName}`)
    if (!fs.existsSync(filePath)) return `File not found: src/tools/${safeName}`
    return fs.readFileSync(filePath, 'utf-8')
  },
})

const readWorkspaceFile = tool({
  name: 'read_workspace_file',
  description: 'Read a file from the workspace folder (e.g. to review code you previously wrote).',
  inputSchema: z.object({
    filename: z.string().describe('The filename to read from workspace'),
  }),
  callback: (input) => {
    const safeName = path.basename(input.filename)
    const filePath = path.join(WORKSPACE_DIR, safeName)
    console.log(`\n📖 [read_workspace_file] Reading: workspace/${safeName}`)
    if (!fs.existsSync(filePath)) return `File not found in workspace: ${safeName}`
    return fs.readFileSync(filePath, 'utf-8')
  },
})

const listToolFiles = tool({
  name: 'list_tool_files',
  description: 'List all tool files in src/tools/ for reference.',
  inputSchema: z.object({}),
  callback: () => {
    console.log(`\n📂 [list_tool_files] Listing tools`)
    const files = fs.readdirSync(TOOLS_DIR).filter(f => f.endsWith('.ts'))
    return `Existing tools:\n${files.map(f => `- ${f}`).join('\n')}`
  },
})

// ===== Tools for Tester Node =====

const typeCheck = tool({
  name: 'type_check',
  description: 'Run TypeScript type checking on a workspace tool file.',
  inputSchema: z.object({
    filename: z.string().describe('The tool filename in workspace'),
  }),
  callback: (input) => {
    const safeName = path.basename(input.filename)
    const filePath = path.join(WORKSPACE_DIR, safeName)
    console.log(`\n🧪 [type_check] Checking: workspace/${safeName}`)
    if (!fs.existsSync(filePath)) return `Error: File not found in workspace: ${safeName}`

    const checkFile = path.join(WORKSPACE_DIR, '_type_check.ts')
    fs.writeFileSync(checkFile, `import './${safeName.replace('.ts', '.js')}';\n`)
    try {
      execSync(`npx tsx ${checkFile} 2>&1`, {
        cwd: path.resolve('.'),
        encoding: 'utf-8',
        timeout: 15000,
      })
      console.log(`🧪 [type_check] ✅ Passed`)
      return `TYPE CHECK PASSED: ${safeName} compiles without errors.`
    } catch (error: unknown) {
      const err = error as { stdout?: string; stderr?: string }
      const output = err.stdout || err.stderr || String(error)
      console.log(`🧪 [type_check] ❌ Failed`)
      return `TYPE CHECK FAILED:\n${output.slice(0, 500)}`
    } finally {
      if (fs.existsSync(checkFile)) fs.unlinkSync(checkFile)
    }
  },
})

const runTool = tool({
  name: 'run_tool',
  description: 'Execute a workspace tool file with test input to verify it works at runtime.',
  inputSchema: z.object({
    filename: z.string().describe('The tool filename in workspace, e.g. "hello.ts"'),
    exportName: z.string().describe('The exported tool variable name, e.g. "hello"'),
    testInput: z.string().describe('JSON string of test input, e.g. {"name": "World"}'),
  }),
  callback: async (input) => {
    const { filename, exportName, testInput } = input
    const safeName = path.basename(filename)
    console.log(`\n🧪 [run_tool] Testing: workspace/${safeName} (export: ${exportName})`)

    const workspaceFile = path.join(WORKSPACE_DIR, safeName)
    if (!fs.existsSync(workspaceFile)) return `Error: File not found in workspace: ${safeName}`

    const testFile = path.join(WORKSPACE_DIR, '_test_runner.ts')
    const testScript = `
import 'dotenv/config'
import crypto from 'crypto'
if (!globalThis.crypto) (globalThis as any).crypto = crypto
import { ${exportName} } from './${safeName.replace('.ts', '.js')}'
async function test() {
  const input = ${testInput}
  const toolAny = ${exportName} as any
  const cb = toolAny._callback || toolAny.execute || toolAny.callback
  if (typeof cb === 'function') {
    const result = await cb(input)
    console.log('RESULT:', result)
  } else {
    console.log('RESULT: ERROR - could not find callback on tool')
  }
}
test()
`
    fs.writeFileSync(testFile, testScript, 'utf-8')
    try {
      const output = execSync(`npx tsx ${testFile} 2>&1`, { cwd: path.resolve('.'), encoding: 'utf-8', timeout: 30000 })
      console.log(`🧪 [run_tool] ✅ Passed`)
      const resultLine = output.split('\n').find(l => l.startsWith('RESULT:')) || output.slice(0, 200)
      return `Runtime test PASSED:\n${resultLine}`
    } catch (error: unknown) {
      const err = error as { stdout?: string }
      console.log(`🧪 [run_tool] ❌ Failed`)
      return `Runtime test FAILED:\n${(err.stdout || String(error)).slice(0, 500)}`
    } finally {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile)
    }
  },
})

// ===== Models =====

const writerModel = new OpenAIModel({
  api: 'chat',
  apiKey: 'dmr-local',
  clientConfig: { baseURL: DMR_BASE_URL },
  modelId: DMR_MODEL_ID,
  temperature: 0.7,
  maxTokens: 4096,
  contextWindowLimit: 32768,
})

const testerModel = new OpenAIModel({
  api: 'chat',
  apiKey: 'dmr-local',
  clientConfig: { baseURL: DMR_BASE_URL },
  modelId: DMR_MODEL_ID,
  temperature: 0.3,
  maxTokens: 4096,
  contextWindowLimit: 32768,
})

// ===== Agent Nodes =====

const writerNode = new Agent({
  id: 'writer',
  name: 'writer',
  description: 'Writes TypeScript tool files to the workspace folder.',
  model: writerModel,
  systemPrompt: `You are a TypeScript developer that creates tools for a Strands Agents SDK project.

Follow this exact pattern:

\`\`\`typescript
import { tool } from '@strands-agents/sdk'
import z from 'zod'

export const myTool = tool({
  name: 'my_tool',
  description: 'What this tool does',
  inputSchema: z.object({
    param: z.string().describe('Parameter description'),
  }),
  callback: async (input) => {
    // Tool logic here
    return 'result'
  },
})
\`\`\`

Rules:
- Always use the exact import pattern
- Use zod for input validation
- Export the tool as a named export
- Use async callback for network requests
- Add console.log with emoji for debugging
- Return a string result
- Read existing tool files for reference if needed
- Write the file to workspace using create_tool_file

If you receive feedback from a failed test:
1. Read your previous code from workspace using read_workspace_file (use the SAME filename you wrote before)
2. Analyze the error
3. Fix the issue and overwrite the SAME file using create_tool_file with the SAME filename
Do NOT create a new file with a different name on retry.

Always include in your response ONLY: the filename and the exported variable name. Be brief.`,
  tools: [createToolFile, readToolFile, readWorkspaceFile, listToolFiles],
  printer: false,
})

const testerNode = new Agent({
  id: 'tester',
  name: 'tester',
  description: 'Tests tool files in workspace by type-checking and running them.',
  model: testerModel,
  systemPrompt: `You are a tool testing agent. Be brief. Your job:
1. Run type_check on the tool file in workspace
2. If type_check FAILED, immediately report STATUS: FAILED. Do NOT run run_tool.
3. If type_check passed, run run_tool ONCE with appropriate test input
4. Output ONLY this format:

If ALL passed:
STATUS: PASSED
FILENAME: <filename>
EXPORT: <export_name>

If failed:
STATUS: FAILED
FILENAME: <filename>
EXPORT: <export_name>
TEST: <which test failed: type_check or run_tool>
ERROR: <the full error message from the failed test>

Do NOT explain anything else. Do NOT run tests multiple times.
IMPORTANT: If type_check fails, you MUST report STATUS: FAILED immediately.`,
  tools: [typeCheck, runTool],
  printer: false,
})

// ===== Graph (write → test loop only) =====
//
// Trade-offs of this approach:
// - Graph: Deterministic flow, but relies on structured output parsing, more complex, fragile
// - Single agent with all tools (alternative): Simpler, more flexible, LLM decides when to stop,
//   but less predictable (might not test, or might loop forever)
//

const toolWriterGraph = new Graph({
  id: 'tool_writer',
  nodes: [writerNode, testerNode],
  sources: ['writer'],
  edges: [
    // writer always goes to tester
    ['writer', 'tester'],
    // tester goes back to writer if failed
    {
      source: 'tester',
      target: 'writer',
      handler: (state) => {
        const testerResults = state.results.filter(r => r.nodeId === 'tester')
        const lastResult = testerResults[testerResults.length - 1]
        if (!lastResult) return false
        const text = lastResult.content.map((b: any) => b.text || '').join('')
        const passed = text.includes('STATUS: PASSED')
        if (!passed) console.log(`\n🔄 [graph] Test failed, routing back to writer`)
        return !passed
      },
    },
  ],
  maxSteps: 22,
})

// ===== Deploy function (no LLM needed) =====

async function deployFromWorkspace(agentInstance?: any): Promise<string> {
  const files = fs.readdirSync(WORKSPACE_DIR).filter(f => f.endsWith('.ts') && !f.startsWith('_'))
  if (files.length === 0) return 'No files in workspace to deploy.'

  const results: string[] = []
  for (const safeName of files) {
    const srcPath = path.join(WORKSPACE_DIR, safeName)
    const destPath = path.join(TOOLS_DIR, safeName)
    const code = fs.readFileSync(srcPath, 'utf-8')

    // Extract tool name from code: name: 'xxx'
    const nameMatch = code.match(/name:\s*['"]([^'"]+)['"]/)
    const descMatch = code.match(/description:\s*['"]([^'"]+)['"]/)
    const toolName = nameMatch?.[1] || safeName.replace('.ts', '')
    const toolDesc = descMatch?.[1] || 'No description'

    // Copy to tools folder
    fs.copyFileSync(srcPath, destPath)
    fs.unlinkSync(srcPath)
    console.log(`\n🚀 [deploy] Deployed: workspace/${safeName} → src/tools/${safeName}`)

    // Add to tools-config.json
    const configPath = path.resolve('./src/tools-config.json')
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Array<{ name: string; file: string | null; description: string }>
    if (!config.find(t => t.name === toolName)) {
      config.push({ name: toolName, file: safeName, description: toolDesc })
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
      console.log(`🚀 [deploy] Added "${toolName}" to tools-config.json`)
    }

    // Hot reload: dynamically import and register with the agent
    if (agentInstance) {
      try {
        const fileUrl = pathToFileURL(destPath).href + '?t=' + Date.now() // cache bust
        const module = await import(fileUrl)
        for (const [, value] of Object.entries(module)) {
          if (value && typeof value === 'object' && '_functionTool' in (value as object)) {
            agentInstance.toolRegistry.add(value)
            console.log(`🔥 [hot-reload] Registered tool "${toolName}" — available immediately, no restart needed`)
            break
          }
        }
      } catch (error) {
        console.warn(`⚠️ [hot-reload] Failed to hot-reload "${toolName}": ${(error as Error).message}. Restart required.`)
      }
    }

    results.push(`Deployed src/tools/${safeName} (tool: ${toolName})`)
  }

  return results.join('\n')
}

// ===== Agent instance reference for hot reload =====
let _mainAgentRef: any = null

export function setMainAgentRef(agent: any) {
  _mainAgentRef = agent
}

// ===== Wrap as a tool for the main agent =====

export const toolWriterTool = tool({
  name: 'tool_writer_agent',
  description: 'A developer pipeline that creates, tests, and deploys new tool files. Delegate to this when the user wants to add a new capability. It writes code in a workspace, tests it, retries if failed, and deploys to src/tools/ when passing.',
  inputSchema: z.object({
    task: z.string().describe('Description of the tool to create, e.g. "create a tool to check stock prices using Yahoo Finance API"'),
  }),
  callback: async (input) => {
    console.log(`\n🏗️ [tool_writer] Starting pipeline: "${input.task}"`)
    try {
      const result = await toolWriterGraph.invoke(input.task)
      const texts: string[] = []
      if (result.content) {
        for (const block of result.content as unknown as Array<Record<string, unknown>>) {
          if ('text' in block && typeof block.text === 'string') {
            texts.push(block.text)
          }
        }
      }
      const graphOutput = texts.join('\n')

      // If tests passed (graph ended normally), deploy
      if (result.status === 'COMPLETED') {
        const deployResult = await deployFromWorkspace(_mainAgentRef)
        return `${graphOutput}\n\n${deployResult}\n\nTool is now available — no restart needed.`
      }

      return graphOutput || 'Tool creation pipeline completed but tests may have failed.'
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error)
      console.log(`🏗️ [tool_writer] Error: ${errMsg}`)
      return `Tool creation failed: ${errMsg}`
    }
  },
})
