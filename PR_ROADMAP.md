# Personal Assistant PR Roadmap

Last updated: 2026-07-10

## Status Overview

- PR1: Completed and pushed to main (`ffe6049`)
- PR2-PR6: Pending

## PR1 - Tool Resilience Layer (Completed)

### Scope

- Added timeout, retry, and circuit-breaker wrapper for tools.
- Integrated resilience wrapper into agent tool bootstrap.
- Added startup diagnostics for wrapped/skipped tools.
- Added strict mode env flag: `TOOL_RESILIENCE_STRICT=true` to fail startup when tools cannot be wrapped.

### Files

- `src/tool-resilience.ts`
- `src/agents/main.ts`

### Validation

- `npm run build` passed.
- Runtime checks performed:
  - Wrapping applied to all loaded tools.
  - Retry path verified.
  - Timeout path verified.
  - Circuit-breaker open/cooldown fail-fast verified.

## PR2 - Critical Tool Startup Validation + Degraded Mode (Pending)

### Goal

Ensure startup policy is explicit: fail fast for missing critical tools, allow degraded mode for optional tools.

### Proposed changes

- Add tool criticality policy map.
- Validate loaded tool set before creating agent.
- Throw startup error if critical tools are missing.
- Log degraded mode summary for optional tool omissions.

### Candidate files

- `src/tool-loader.ts`
- `src/agents/main.ts`
- `src/tools-config.json`

### Acceptance criteria

- Missing critical tool causes startup failure with exact missing list.
- Missing optional tool does not crash startup.
- Startup logs final capability set and degraded status.

## PR3 - Memory Quality Upgrade (Pending)

### Goal

Improve long-term memory precision and hygiene.

### Proposed changes

- Add richer metadata fields for memory entries.
- Add duplicate suppression before write.
- Improve recall ranking (semantic + recency weighting).
- Add category-aware retrieval filters.

### Candidate files

- `src/tools/memory.ts`

### Acceptance criteria

- Duplicate memory writes reduced.
- Recall relevance improved for repeated queries.
- Memory metadata consistent and queryable.

## PR4 - Guardrail Hardening with Tool-Level Policy (Pending)

### Goal

Move from generic sensitivity checks to explicit per-tool policy controls.

### Proposed changes

- Add tool-level policy matrix (external tools vs destructive tools).
- Enforce confirmation token/state for destructive operations.
- Expand detection patterns while minimizing false positives.
- Keep existing pre-tool hook and integrate policy decisions there.

### Candidate files

- `src/guardrail.ts`
- `src/agents/main.ts`
- `src/tools-config.json`

### Acceptance criteria

- Destructive tools blocked without confirmation.
- Sensitive payloads blocked for external tools.
- Guardrail behavior is auditable via logs.

## PR5 - Quality Gates (Test/Lint/Healthcheck/CI) (Pending)

### Goal

Add repeatable quality checks to prevent regressions.

### Proposed changes

- Add scripts: `typecheck`, `lint`, `test`, `healthcheck`.
- Add tests for guardrail and resilience logic first.
- Add lightweight runtime smoke test for chat endpoint/tool bootstrap.
- Add CI workflow for build + checks on push/PR.

### Candidate files

- `package.json`
- `tsconfig.json`
- `src/server.ts`
- `.github/workflows/*` (new)

### Acceptance criteria

- CI fails when checks fail.
- Core reliability/safety regressions caught in automated checks.
- Single command gives health status.

## PR6 - Person Context Composite Tool (Long-term Fix) (Pending)

### Goal

Eliminate multi-step planning misses by returning relationship + profile/preferences in one call.

### Proposed changes

- Add a composite people tool (for example: `get_person_context`) that:
  - resolves person by relationship/name from graph data,
  - fetches profile/preferences from semantic store,
  - returns one normalized response for assistant decisions.
- Update prompt guidance to prefer the composite tool for person preference queries.

### Candidate files

- `src/tools/people.ts`
- `src/tools-config.json`
- `src/agents/main.ts`

### Acceptance criteria

- For prompts like "buy a drink for my wife", the assistant can retrieve relation and preference in one tool call path.
- No redundant repeated calls to `find_person` for the same person in a single turn.
- Assistant only asks follow-up preference questions when composite lookup returns no preference data.

### Sample conversation (observed)

Current behavior (before composite tool):

```text
User: hello how are you today?
Assistant: 你好！我好，多謝查詢。今日有咩我可以幫到你嗎？

User: i want to buy a drink for my wife
Assistant: 你想為你太太送咩飲品呀？如果你有佢嘅口味偏好（例如鍾意奶茶、咖啡定係果汁），你可以話我知，我可以幫你搵吓附近嘅選擇。

User: you should know what does she love to drink
Assistant: 收到，你太太鍾意飲奶茶。你想買邊間嘅畀佢呀？我可以幫你搵下附近有無賣呢款飲品嘅店。
```

Expected behavior after PR6:

```text
User: i want to buy a drink for my wife
Assistant: 收到，我查到你太太鍾意飲奶茶。你想我幫你搵附近邊間有得買嗎？
```

## Suggested Execution Order

1. PR2 - Critical tool startup validation
2. PR4 - Guardrail hardening
3. PR3 - Memory quality
4. PR5 - Quality gates
5. PR6 - Person context composite tool

Reason: lock startup correctness and safety first, then improve memory behavior, then harden delivery pipeline.
