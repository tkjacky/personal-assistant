# Personal Assistant

A local personal assistant that extends itself. It runs a [Strands](https://github.com/strands-agents/sdk-typescript) agent on **Gemma 4 12B** through Docker Model Runner. When a request needs a capability the agent does not have, it writes a new JavaScript tool, tests it, and loads it into the running process.

This is a personal proof of concept. The new capability is code the agent writes and loads. The model weights do not change.

## Tech stack

- **JavaScript** is the language of the agent and the tools. Node.js runs the application.
- **Strands Agents SDK** controls the agent. The agent calls tools to get data and to do tasks.
- **Gemma 4 12B** writes the replies. Docker Model Runner serves the model through an OpenAI-compatible API.
- **Express** serves the web page and the chat API.
- **ChromaDB** stores text that the assistant can search by meaning. The store holds facts, notes about people, and the identity of the assistant.
- **Neo4j** stores people and the relations between them. For example, the graph can record that one person is the colleague of the user.
- **Docker Compose** starts ChromaDB and Neo4j on the local machine.

## Self-extending tools

This is the main feature. The system prompt tells the agent to call `tool_writer_agent` when a missing tool would solve the problem. That tool runs a two-node graph in `src/agents/tool-writer.ts`:

1. **Writer** drafts a Strands `tool()` and saves it under `workspace/`. It can read existing files in `src/tools/` and match their pattern.
2. **Tester** imports the file with `tsx`. A failed import stops the run. A successful import is followed by one sample call.
3. A failed test routes back to the writer, which edits the same file. The graph allows up to 22 steps.
4. When the graph completes, deploy copies the file into `src/tools/`, appends an entry to `src/tools-config.json`, and registers the tool on the live agent. The next turn can call it. No restart.

```
user request
    │
    ▼
main agent ── missing capability ──► tool_writer_agent
                                        │
                                        ▼
                                     writer ──► workspace/*.ts
                                        ▲              │
                                        │              ▼
                                        └── fail ──── tester
                                        (type check, then one run)
                                                       │
                                                      pass
                                                       ▼
                                            src/tools/ + tools-config.json
                                                       │
                                                       ▼
                                            hot-reload into the running agent
```

`get_exchange_rate` in `src/tools/currency_exchange.ts` is a tool this pipeline added. On the next startup, `src/tool-loader.ts` imports every file listed in `src/tools-config.json`, so the tool stays.

The writer and the tester use the same local model. Generated code runs on your machine through `tsx`. The check is an import plus one sample call. There is no sandbox.

## Architecture

```
Web UI (public/index.html)
        │  SSE  /api/chat
        ▼
Express (src/server.ts)
        │
        ▼
Strands agent (src/agents/main.ts)
        │
        ├── Docker Model Runner (Gemma 4 12B, OpenAI-compatible API)
        ├── tools loaded from src/tools-config.json
        ├── tool writer graph (write → test → deploy)
        ├── Chroma: facts, people profiles, assistant identity
        ├── Neo4j: who knows whom
        └── ./sessions: conversation snapshots + summary compression
```

The agent replies in Cantonese. The page at `http://localhost:3000` takes typed messages and hold-to-talk input (`zh-HK`), and can speak replies with the browser.

`POST /api/chat?stream=false` returns one JSON body, `{ "response": "..." }`, for a simple client such as a Siri Shortcut on the same network.

## Built-in tools

| Tool | What it does |
|------|----------------|
| `web_search` | Web search through Tavily. Needs `TAVILY_API_KEY`. |
| `weather`, `crypto_price`, `get_exchange_rate`, `get_current_date_time` | Live lookups. |
| `remember`, `recall`, `forget` | Long-term facts in Chroma. |
| `save_person`, `find_person`, `search_people`, `list_people`, `update_person`, `remove_person` | Relationships in Neo4j, profiles in Chroma. |
| `set_identity`, `get_identity` | The assistant's own name and traits, stored in Chroma. |
| `tv_control` | Panasonic VIERA commands on the local network. |
| `tool_writer_agent` | Writes, tests, and hot-loads a new tool. Registered in code, not loaded from a file. |

People are stored in two places. Neo4j records who is related to whom. Chroma stores notes that can be searched by meaning, such as "who likes hiking". Facts that are not about a person go through `remember` and `recall`.

Before a tool runs, a guardrail in `src/guardrail.ts` blocks inputs that look like passwords, card numbers, emails, phone numbers, and similar secrets. Each call also goes through a timeout, retry, and circuit breaker in `src/tool-resilience.ts`.

Older turns are summarized so the conversation stays inside the context window. Snapshots are written under `./sessions`.

## Prerequisites

1. Docker Desktop with Model Runner enabled (Settings → Features in development → Docker Model Runner).
2. Node.js 20+.

## Setup

### 1. Pull the model

```bash
docker model pull huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf
```

### 2. Start Chroma and Neo4j

```bash
docker compose up -d
```

ChromaDB listens on port 8100, the Chroma admin UI on 8101, and Neo4j on 7474 and 7687. Neo4j starts with authentication disabled (`NEO4J_AUTH=none`), so keep it on your own machine.

### 3. Configure

```bash
cp .env.example .env
```

Leave `TAVILY_API_KEY` empty to run without web search. Set `WEB_SEARCH_ENABLED=false` to drop that tool at startup. `TV_IP` is only needed for `tv_control`. `.env` is gitignored.

### 4. Run

```bash
npm install
npm start
```

Open http://localhost:3000.

```bash
npm test        # guardrail and tool resilience
npm run dev     # restart when files change
npm run build
```

## Try the tool writer

Ask for something the current tools cannot do. For example:

> I need a tool that looks up the current price of a Hong Kong stock.

The server log shows `[tool_writer]`, `[type_check]`, `[run_tool]`, and, on success, `[hot-reload]`. Ask the same question again. The new tool should answer, and `src/tools/` plus `src/tools-config.json` should contain the new file.

To add a tool yourself, put a Strands `tool()` module in `src/tools/` and add a `{ "name", "file", "description" }` entry to `src/tools-config.json`. Restart to load it.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DMR_BASE_URL` | `http://localhost:12434/v1` | Docker Model Runner OpenAI-compatible endpoint |
| `DMR_MODEL_ID` | `huggingface.co/google/gemma-4-12b-it-qat-q4_0-gguf` | Model id served by DMR |
| `PORT` | `3000` | Web server port |
| `AUDIO_ENABLED` | on | Browser speech playback. Set `false` to disable. |
| `WEB_SEARCH_ENABLED` | on | Set `false` to unload `web_search`. |
| `TAVILY_API_KEY` | empty | Tavily key for `web_search` |
| `USER_NAME` | `User` | Name injected into the system prompt |
| `USER_LOCATION` | `Hong Kong` | Location injected into the system prompt |
| `CONTEXT_WINDOW_LIMIT` | `32768` | Context window used for summarization |
| `SESSION_ID` | `default` | Conversation snapshot id under `./sessions` |
| `CHROMA_HOST` / `CHROMA_PORT` | `localhost` / `8100` | ChromaDB |
| `NEO4J_URL` | `bolt://localhost:7687` | Neo4j Bolt URL |
| `TV_IP` / `TV_PORT` | `localhost` / `55000` | Panasonic VIERA address |
| `TOOL_TIMEOUT_MS`, `TOOL_MAX_RETRIES`, `TOOL_BREAKER_ENABLED` | see `src/tool-resilience.ts` | Default timeout, retry, and circuit breaker. Per-tool overrides use `TOOL_<NAME>_*`. |
| `TOOL_RESILIENCE_STRICT` | `false` | Set `true` to fail startup when a tool cannot be wrapped |

## Layout

```
src/agents/main.ts         agent, system prompt, guardrail, session
src/agents/tool-writer.ts  write → test → deploy graph
src/tool-loader.ts         loads src/tools-config.json at startup
src/tool-resilience.ts     timeout, retry, circuit breaker
src/guardrail.ts           blocks sensitive tool inputs
src/tools/                 tool modules, including ones the agent wrote
public/index.html          chat, hold-to-talk, speech playback
docker-compose.yml         ChromaDB, Chroma admin, Neo4j
```
