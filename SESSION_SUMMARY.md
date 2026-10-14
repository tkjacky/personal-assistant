# Personal Assistant - Session Summary

## Project Overview
A local AI personal assistant built with Strands Agents SDK (TypeScript) running Gemma 4 12B on Docker Model Runner (DMR), with a web UI featuring push-to-talk voice input and Cantonese TTS.

## Repository
- **Branches:** `main` (Strands TypeScript), `langgraph-python` (LangGraph Python migration)

## Architecture

### Server
- **Entry:** `server.ts` → Express/FastAPI serving `public/index.html`
- **Agent:** `src/agents/main.ts` — ReAct agent with dynamic tool loading from `src/tools-config.json`
- **Tool Loader:** `src/tool-loader.ts` — dynamically imports tools listed in config on startup

### LLM
- Gemma 4 12B (Q4_0 GGUF) on Docker Model Runner
- Endpoint: `http://<DMR_HOST>:12434/v1` (configured in `.env`)
- Context window: 32768 tokens (configurable)
- Keep-alive: 30 minutes (`docker model configure --keep-alive 30m`)
- Temperature: 1.0

### Session & Memory
- **Session persistence:** Strands `SessionManager` + `FileStorage` → `./sessions/`
- **Conversation manager:** `SummarizingConversationManager` (preserveRecentMessages: 50, summaryRatio: 0.5, compressionThreshold: 0.7)
- **Long-term memory:** ChromaDB `memories` collection (remember/recall/forget tools)
- **People profiles:** ChromaDB `people` collection (semantic search on profiles/preferences)
- **Assistant identity:** ChromaDB `identity` collection (set_identity/get_identity)
- **Relationships:** Neo4j graph (Person → Person with KNOWS edges)

### Docker Compose Services
- **ChromaDB** (port 8100) — vector DB for memory/people/identity
- **ChromaDB Admin** (port 8101) — web UI for browsing collections
- **Neo4j Community** (ports 7474/7687) — knowledge graph for relationships

### Tools (src/tools-config.json)
1. `web_search` — Tavily API
2. `crypto_price` — CoinGecko
3. `weather` — wttr.in
4. `get_current_date_time` — local
5. `tv_control` — Panasonic VIERA SOAP API (<TV_IP>:55000)
6. `remember` / `recall` / `forget` — ChromaDB memories
7. `save_person` / `find_person` / `search_people` / `list_people` / `update_person` / `remove_person` — Neo4j + ChromaDB people
8. `set_identity` / `get_identity` — ChromaDB identity
9. `get_exchange_rate` — open.er-api.com (created by tool writer)
10. `tool_writer_agent` — self-extending tool creation pipeline

### Tool Writer Pipeline (src/agents/tool-writer.ts)
- **Graph pattern:** writer → tester → (pass → deploy) / (fail → writer retry)
- **Writer node:** Creates tool in `workspace/`, reads existing tools for reference
- **Tester node:** Type check (tsx import) + runtime test, outputs structured STATUS: PASSED/FAILED
- **Deploy function:** Copies from workspace → src/tools/, adds to tools-config.json, hot-reloads via `agent.toolRegistry.add()`
- **Max retries:** 10 (maxSteps: 22)

### Guardrail (src/guardrail.ts)
- Uses Strands `BeforeToolCallEvent` hook
- Blocks PII/sensitive data from being sent to tools
- Whitelists `mem_*` and `tooluse_*` patterns

### Web UI (public/index.html)
- Push-to-talk mic (Web Speech API, `zh-HK`)
- Browser TTS (2.0x speed, female voice preferred)
- Stop speech button
- Audio on/off from `.env` (`AUDIO_ENABLED`)

### iOS Integration
- Siri Shortcut: 聽寫文字 → POST to /api/chat → 朗讀文字 (Cantonese)
- Only works on same WiFi

## Configuration
Copy `.env.example` to `.env`. `.env` is gitignored. Do not commit API keys, a TV address, or a home location.

## How to Run
```powershell
docker compose up -d        # Start ChromaDB + Neo4j
npm start                   # Start the assistant
# Open http://localhost:3000
```

## Known Issues / TODOs
- User preferences ("I love latte") stored in `memories` instead of `people` collection — LLM prompt needs better routing
- Neo4j has old test data sometimes — clear with Cypher: `MATCH (n) DETACH DELETE n`
- `sharp` module needs `npm rebuild sharp` when switching between WSL and Windows
- TV can't be powered on via API (WiFi drops in standby)

## Key Decisions Made
- Strands vs LangGraph: functionally equivalent, kept Strands on main
- Graph pattern (deterministic) vs Agents-as-Tools (flexible) for tool writer — chose Graph with retry wrapper
- Neo4j for relationships only, ChromaDB for semantic profiles
- Dynamic tool loading from tools-config.json (no manual imports needed)
- Hot-reload via toolRegistry.add() — new tools available without restart
- SummarizingConversationManager: preserveRecentMessages=50, compressionThreshold=0.7, summaryRatio=0.5
- Browser-based TTS/STT (no Windows SAPI dependency)

## LangGraph Branch (langgraph-python)
- Fully working migration: FastAPI + LangGraph StateGraph + SQLite checkpointer
- Same tools ported to Python with @tool decorator
- Tool writer uses StateGraph with conditional edges (should_retry function)
- Dynamic tool loading via importlib
- Run with: `source .venv/bin/activate && python server.py`

## Notes: Strands vs LangGraph — Checkpointer/Session Comparison

### Architecture (both the same)
```
In-memory state (messages, tools) ← agent works with this
        │ save
        ▼
Persistence (disk) ← survives restart
        │ restore on startup
        ▼
In-memory state (restored from latest)
```

### Key Differences

| | Strands | LangGraph |
|--|---------|-----------|
| Persistence format | JSON files | SQLite (or Postgres) |
| Latest state | `snapshot_latest.json` (1 file, overwritten) | Latest checkpoint in DB |
| History | Optional immutable snapshots (only if `snapshotTrigger` configured) | Automatic — every step/invocation saved |
| Time-travel | Only to manually triggered snapshots | To any previous checkpoint |
| Compression behavior | Once compressed, old messages gone from latest (and from disk if no snapshot taken before) | Old checkpoints still contain pre-compression messages |
| Default behavior | Latest only, no history | Full history by default |

### To make Strands equivalent to LangGraph:
- Enable `snapshotTrigger` to fire frequently
- But even then, if compression happens between snapshots, pre-compression state is lost
- LangGraph saves automatically before compression — Strands doesn't

### Bottom line:
- LangGraph checkpointer = full automatic history, non-destructive
- Strands snapshot = latest by default, opt-in history, potentially destructive on compression
