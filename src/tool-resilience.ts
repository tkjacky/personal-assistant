type BreakerMode = 'closed' | 'open' | 'half_open'

interface BreakerState {
  mode: BreakerMode
  openUntil: number | null
  lastFailureAt: number | null
  failureTimestamps: number[]
  halfOpenProbeCount: number
  halfOpenSuccessCount: number
}

interface BreakerPolicy {
  enabled: boolean
  failureWindowMs: number
  failureThreshold: number
  cooldownMs: number
  halfOpenMaxProbes: number
  halfOpenSuccessesToClose: number
}

export interface ToolResiliencePolicy {
  timeoutMs: number
  maxRetries: number
  backoffMs: number
  backoffMultiplier: number
  breaker: BreakerPolicy
}

type ToolLike = Record<string, unknown>

type ToolCallback = (input: unknown) => unknown | Promise<unknown>

const TRANSIENT_MESSAGE_PATTERNS: RegExp[] = [
  /timeout/i,
  /timed out/i,
  /econnreset/i,
  /econnrefused/i,
  /enotfound/i,
  /eai_again/i,
  /network/i,
  /temporar/i,
  /service unavailable/i,
  /bad gateway/i,
  /gateway timeout/i,
  /too many requests/i,
  /\b429\b/,
  /\b502\b/,
  /\b503\b/,
  /\b504\b/,
]

function readIntEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampInt(value: number, min: number): number {
  return value < min ? min : value
}

function normalizeToolEnvName(toolName: string): string {
  return toolName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

function parseSpecificToolEnvPolicy(toolName: string, base: ToolResiliencePolicy): ToolResiliencePolicy {
  const prefix = `TOOL_${normalizeToolEnvName(toolName)}_`
  return {
    timeoutMs: readIntEnv(`${prefix}TIMEOUT_MS`, base.timeoutMs),
    maxRetries: readIntEnv(`${prefix}MAX_RETRIES`, base.maxRetries),
    backoffMs: readIntEnv(`${prefix}BACKOFF_MS`, base.backoffMs),
    backoffMultiplier: readIntEnv(`${prefix}BACKOFF_MULTIPLIER`, base.backoffMultiplier),
    breaker: {
      enabled: (process.env[`${prefix}BREAKER_ENABLED`] ?? String(base.breaker.enabled)).toLowerCase() !== 'false',
      failureWindowMs: readIntEnv(`${prefix}BREAKER_FAILURE_WINDOW_MS`, base.breaker.failureWindowMs),
      failureThreshold: readIntEnv(`${prefix}BREAKER_FAILURE_THRESHOLD`, base.breaker.failureThreshold),
      cooldownMs: readIntEnv(`${prefix}BREAKER_COOLDOWN_MS`, base.breaker.cooldownMs),
      halfOpenMaxProbes: readIntEnv(`${prefix}BREAKER_HALF_OPEN_PROBES`, base.breaker.halfOpenMaxProbes),
      halfOpenSuccessesToClose: readIntEnv(`${prefix}BREAKER_HALF_OPEN_SUCCESSES`, base.breaker.halfOpenSuccessesToClose),
    },
  }
}

function loadDefaultPolicyFromEnv(): ToolResiliencePolicy {
  return {
    timeoutMs: readIntEnv('TOOL_TIMEOUT_MS', 6000),
    maxRetries: readIntEnv('TOOL_MAX_RETRIES', 1),
    backoffMs: readIntEnv('TOOL_BACKOFF_MS', 250),
    backoffMultiplier: readIntEnv('TOOL_BACKOFF_MULTIPLIER', 2),
    breaker: {
      enabled: (process.env.TOOL_BREAKER_ENABLED ?? 'true').toLowerCase() !== 'false',
      failureWindowMs: readIntEnv('TOOL_BREAKER_FAILURE_WINDOW_MS', 60000),
      failureThreshold: readIntEnv('TOOL_BREAKER_FAILURE_THRESHOLD', 5),
      cooldownMs: readIntEnv('TOOL_BREAKER_COOLDOWN_MS', 30000),
      halfOpenMaxProbes: readIntEnv('TOOL_BREAKER_HALF_OPEN_PROBES', 1),
      halfOpenSuccessesToClose: readIntEnv('TOOL_BREAKER_HALF_OPEN_SUCCESSES', 1),
    },
  }
}

const STATIC_TOOL_POLICIES: Record<string, Partial<ToolResiliencePolicy>> = {
  weather: { timeoutMs: 7000, maxRetries: 2 },
  web_search: { timeoutMs: 8000, maxRetries: 2 },
  crypto_price: { timeoutMs: 6000, maxRetries: 2 },
  get_exchange_rate: { timeoutMs: 6000, maxRetries: 2 },
  tv_control: { timeoutMs: 2500, maxRetries: 0 },
  remember: { timeoutMs: 5000, maxRetries: 1 },
  recall: { timeoutMs: 5000, maxRetries: 1 },
  save_person: { timeoutMs: 5000, maxRetries: 1 },
  find_person: { timeoutMs: 5000, maxRetries: 1 },
  search_people: { timeoutMs: 5000, maxRetries: 1 },
  list_people: { timeoutMs: 5000, maxRetries: 1 },
  update_person: { timeoutMs: 5000, maxRetries: 1 },
  remove_person: { timeoutMs: 5000, maxRetries: 1 },
  set_identity: { timeoutMs: 5000, maxRetries: 1 },
  get_identity: { timeoutMs: 5000, maxRetries: 1 },
  tool_writer_agent: {
    timeoutMs: 20000,
    maxRetries: 0,
    breaker: {
      enabled: true,
      failureWindowMs: 60000,
      failureThreshold: 2,
      cooldownMs: 60000,
      halfOpenMaxProbes: 1,
      halfOpenSuccessesToClose: 1,
    },
  },
}

function mergePolicy(base: ToolResiliencePolicy, override: Partial<ToolResiliencePolicy> | undefined): ToolResiliencePolicy {
  return {
    timeoutMs: override?.timeoutMs ?? base.timeoutMs,
    maxRetries: override?.maxRetries ?? base.maxRetries,
    backoffMs: override?.backoffMs ?? base.backoffMs,
    backoffMultiplier: override?.backoffMultiplier ?? base.backoffMultiplier,
    breaker: {
      enabled: override?.breaker?.enabled ?? base.breaker.enabled,
      failureWindowMs: override?.breaker?.failureWindowMs ?? base.breaker.failureWindowMs,
      failureThreshold: override?.breaker?.failureThreshold ?? base.breaker.failureThreshold,
      cooldownMs: override?.breaker?.cooldownMs ?? base.breaker.cooldownMs,
      halfOpenMaxProbes: override?.breaker?.halfOpenMaxProbes ?? base.breaker.halfOpenMaxProbes,
      halfOpenSuccessesToClose: override?.breaker?.halfOpenSuccessesToClose ?? base.breaker.halfOpenSuccessesToClose,
    },
  }
}

function sanitizePolicy(policy: ToolResiliencePolicy): ToolResiliencePolicy {
  return {
    timeoutMs: clampInt(policy.timeoutMs, 1),
    maxRetries: clampInt(policy.maxRetries, 0),
    backoffMs: clampInt(policy.backoffMs, 0),
    backoffMultiplier: clampInt(policy.backoffMultiplier, 1),
    breaker: {
      enabled: policy.breaker.enabled,
      failureWindowMs: clampInt(policy.breaker.failureWindowMs, 1),
      failureThreshold: clampInt(policy.breaker.failureThreshold, 1),
      cooldownMs: clampInt(policy.breaker.cooldownMs, 1),
      halfOpenMaxProbes: clampInt(policy.breaker.halfOpenMaxProbes, 1),
      halfOpenSuccessesToClose: clampInt(policy.breaker.halfOpenSuccessesToClose, 1),
    },
  }
}

function extractToolName(tool: ToolLike): string {
  const toolName = ((tool as { _functionTool?: { name?: unknown } })._functionTool?.name ?? tool.name) as unknown
  if (typeof toolName === 'string' && toolName.trim().length > 0) return toolName
  return 'unknown_tool'
}

function getToolCallback(tool: ToolLike): ToolCallback | null {
  const candidateKeys = ['_callback', 'callback', 'execute'] as const
  for (const key of candidateKeys) {
    const value = tool[key]
    if (typeof value === 'function') {
      return value as ToolCallback
    }
  }

  const fnTool = (tool as { _functionTool?: { callback?: unknown } })._functionTool
  if (fnTool && typeof fnTool.callback === 'function') {
    return fnTool.callback as ToolCallback
  }

  return null
}

function applyToolCallback(tool: ToolLike, wrapped: ToolCallback): void {
  if (typeof tool._callback === 'function') {
    tool._callback = wrapped as unknown
  }
  if (typeof tool.callback === 'function') {
    tool.callback = wrapped as unknown
  }
  if (typeof tool.execute === 'function') {
    tool.execute = wrapped as unknown
  }

  const fnTool = (tool as { _functionTool?: { callback?: unknown } })._functionTool
  if (fnTool && typeof fnTool.callback === 'function') {
    fnTool.callback = wrapped as unknown
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, toolName: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`Tool \"${toolName}\" timed out after ${timeoutMs}ms`)
      ;(error as Error & { code?: string }).code = 'ETIMEDOUT'
      reject(error)
    }, timeoutMs)
  })

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function isRetryableStatusCode(message: string): boolean {
  return /\b(429|502|503|504)\b/.test(message)
}

function isNonTransientMessage(message: string): boolean {
  return /validation|invalid input|schema|zod|unauthorized|forbidden|\b401\b|\b403\b/i.test(message)
}

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (isNonTransientMessage(message)) return false
  if (isRetryableStatusCode(message)) return true
  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))
}

function pruneFailureWindow(state: BreakerState, now: number, windowMs: number): void {
  state.failureTimestamps = state.failureTimestamps.filter((ts) => now - ts <= windowMs)
}

function transitionToOpen(state: BreakerState, now: number, cooldownMs: number): void {
  state.mode = 'open'
  state.openUntil = now + cooldownMs
  state.halfOpenProbeCount = 0
  state.halfOpenSuccessCount = 0
}

function resetBreaker(state: BreakerState): void {
  state.mode = 'closed'
  state.openUntil = null
  state.failureTimestamps = []
  state.halfOpenProbeCount = 0
  state.halfOpenSuccessCount = 0
}

function createInitialBreakerState(): BreakerState {
  return {
    mode: 'closed',
    openUntil: null,
    lastFailureAt: null,
    failureTimestamps: [],
    halfOpenProbeCount: 0,
    halfOpenSuccessCount: 0,
  }
}

function buildTemporarilyUnavailableMessage(toolName: string, openUntil: number | null): string {
  if (!openUntil) {
    return `Tool \"${toolName}\" is temporarily unavailable due to repeated transient failures. Please try again shortly.`
  }

  const secondsLeft = Math.max(1, Math.ceil((openUntil - Date.now()) / 1000))
  return `Tool \"${toolName}\" is temporarily unavailable due to repeated transient failures. Please retry in about ${secondsLeft} second(s).`
}

function resolvePolicy(toolName: string, basePolicy: ToolResiliencePolicy, overrides: Record<string, Partial<ToolResiliencePolicy>>): ToolResiliencePolicy {
  const staticPolicy = STATIC_TOOL_POLICIES[toolName]
  const externalOverride = overrides[toolName]
  let merged = mergePolicy(basePolicy, staticPolicy)
  merged = mergePolicy(merged, externalOverride)
  merged = parseSpecificToolEnvPolicy(toolName, merged)
  return sanitizePolicy(merged)
}

export function wrapToolsWithResilience<T>(
  tools: T[],
  overrides: Record<string, Partial<ToolResiliencePolicy>> = {}
): T[] {
  const defaultPolicy = sanitizePolicy(loadDefaultPolicyFromEnv())
  const breakerStates = new Map<string, BreakerState>()
  const strictMode = (process.env.TOOL_RESILIENCE_STRICT ?? 'false').toLowerCase() === 'true'
  let wrappedCount = 0
  const skippedTools: string[] = []

  const wrappedTools = tools.map((tool) => {
    if (!tool || typeof tool !== 'object') return tool

    const toolObj = tool as ToolLike
    const toolName = extractToolName(toolObj)
    const callback = getToolCallback(toolObj)

    if (!callback) {
      skippedTools.push(toolName)
      console.warn(`[resilience] Skipping tool \"${toolName}\": callback key not found`) 
      return tool
    }

    const policy = resolvePolicy(toolName, defaultPolicy, overrides)
    const state = createInitialBreakerState()
    breakerStates.set(toolName, state)

    const wrappedCallback: ToolCallback = async (input: unknown) => {
      const now = Date.now()

      if (policy.breaker.enabled && state.mode === 'open') {
        if (state.openUntil && now < state.openUntil) {
          console.warn(`[resilience] Breaker OPEN for \"${toolName}\" until ${new Date(state.openUntil).toISOString()}`)
          return buildTemporarilyUnavailableMessage(toolName, state.openUntil)
        }

        state.mode = 'half_open'
        state.halfOpenProbeCount = 0
        state.halfOpenSuccessCount = 0
        console.warn(`[resilience] Breaker HALF_OPEN for \"${toolName}\"`) 
      }

      if (policy.breaker.enabled && state.mode === 'half_open') {
        if (state.halfOpenProbeCount >= policy.breaker.halfOpenMaxProbes) {
          return buildTemporarilyUnavailableMessage(toolName, state.openUntil)
        }
        state.halfOpenProbeCount += 1
      }

      let attempt = 0
      let lastError: unknown = null

      while (attempt <= policy.maxRetries) {
        try {
          const result = await withTimeout(Promise.resolve(callback(input)), policy.timeoutMs, toolName)

          if (policy.breaker.enabled && state.mode === 'half_open') {
            state.halfOpenSuccessCount += 1
            if (state.halfOpenSuccessCount >= policy.breaker.halfOpenSuccessesToClose) {
              resetBreaker(state)
              console.log(`[resilience] Breaker CLOSED for \"${toolName}\" after successful probe`)
            }
          }

          return result
        } catch (error) {
          lastError = error
          const transient = isTransientError(error)
          const isFinalAttempt = attempt >= policy.maxRetries || !transient

          if (!isFinalAttempt) {
            const delayMs = Math.round(policy.backoffMs * Math.pow(policy.backoffMultiplier, attempt))
            await sleep(delayMs)
            attempt += 1
            continue
          }

          const countedFailure = transient || (error instanceof Error && (error as Error & { code?: string }).code === 'ETIMEDOUT')
          if (policy.breaker.enabled) {
            const failNow = Date.now()
            state.lastFailureAt = failNow

            if (countedFailure) {
              state.failureTimestamps.push(failNow)
              pruneFailureWindow(state, failNow, policy.breaker.failureWindowMs)

              const thresholdReached = state.failureTimestamps.length >= policy.breaker.failureThreshold
              if (state.mode === 'half_open' || thresholdReached) {
                transitionToOpen(state, failNow, policy.breaker.cooldownMs)
                console.warn(
                  `[resilience] Breaker OPEN for \"${toolName}\" after failure (recent failures: ${state.failureTimestamps.length})`
                )
              }
            }
          }

          throw lastError
        }
      }

      throw lastError
    }

    applyToolCallback(toolObj, wrappedCallback)
    wrappedCount += 1
    return toolObj as T
  })

  console.log(`[resilience] Wrapped ${wrappedCount}/${tools.length} tools (${skippedTools.length} skipped)`)

  if (strictMode && skippedTools.length > 0) {
    throw new Error(
      `TOOL_RESILIENCE_STRICT is enabled. Could not wrap tool callbacks for: ${skippedTools.join(', ')}`
    )
  }

  return wrappedTools
}
