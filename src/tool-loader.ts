import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_DIR = path.join(__dirname, 'tools')
const CONFIG_PATH = path.join(__dirname, 'tools-config.json')

interface ToolConfig {
  name: string
  file: string | null
  description: string
}

/**
 * Load all tools listed in tools-config.json.
 * Each entry with a file path will be dynamically imported.
 */
export async function loadTools(): Promise<unknown[]> {
  const tools: unknown[] = []

  const config: ToolConfig[] = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))

  for (const entry of config) {
    if (!entry.file) continue

    const filePath = path.join(TOOLS_DIR, entry.file)
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️ Tool file not found: src/tools/${entry.file} (tool: ${entry.name})`)
      continue
    }

    try {
      const fileUrl = pathToFileURL(filePath).href
      const module = await import(fileUrl)

      for (const [, value] of Object.entries(module)) {
        if (value && typeof value === 'object' && '_functionTool' in (value as object)) {
          const toolName = (value as any)._functionTool?.name
          if (toolName === entry.name) {
            tools.push(value)
            break
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ Failed to load tool "${entry.name}" from ${entry.file}:`, (error as Error).message)
    }
  }

  return tools
}
