import assert from 'node:assert/strict'
import test from 'node:test'
import { wrapToolsWithResilience } from '../src/tool-resilience.ts'

const ENV_KEYS = [
  'TOOL_TIMEOUT_MS',
  'TOOL_MAX_RETRIES',
  'TOOL_BACKOFF_MS',
  'TOOL_BACKOFF_MULTIPLIER',
  'TOOL_BREAKER_ENABLED',
  'TOOL_BREAKER_FAILURE_WINDOW_MS',
  'TOOL_BREAKER_FAILURE_THRESHOLD',
  'TOOL_BREAKER_COOLDOWN_MS',
  'TOOL_BREAKER_HALF_OPEN_PROBES',
  'TOOL_BREAKER_HALF_OPEN_SUCCESSES',
  'TOOL_RESILIENCE_STRICT',
]

function withEnv(values: Record<string, string>, run: () => Promise<void>): Promise<void> {
  const previous = new Map<string, string | undefined>()
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key])
    delete process.env[key]
  }
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value
  }
  return run().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
}

function toolWith(name: string, callback: (input: unknown) => unknown) {
  return { name, callback }
}

test('returns the tool result', async () => {
  await withEnv({ TOOL_TIMEOUT_MS: '1000', TOOL_MAX_RETRIES: '0', TOOL_BREAKER_ENABLED: 'false' }, async () => {
    const [tool] = wrapToolsWithResilience([toolWith('demo_tool', async () => 'ok')])
    const result = await tool.callback({})
    assert.equal(result, 'ok')
  })
})

test('retries a transient failure', async () => {
  await withEnv({
    TOOL_TIMEOUT_MS: '1000',
    TOOL_MAX_RETRIES: '1',
    TOOL_BACKOFF_MS: '0',
    TOOL_BREAKER_ENABLED: 'false',
  }, async () => {
    let calls = 0
    const [tool] = wrapToolsWithResilience([
      toolWith('demo_tool', async () => {
        calls += 1
        if (calls === 1) throw new Error('503 service unavailable')
        return 'recovered'
      }),
    ])
    assert.equal(await tool.callback({}), 'recovered')
    assert.equal(calls, 2)
  })
})

test('does not retry a validation error', async () => {
  await withEnv({
    TOOL_TIMEOUT_MS: '1000',
    TOOL_MAX_RETRIES: '3',
    TOOL_BACKOFF_MS: '0',
    TOOL_BREAKER_ENABLED: 'false',
  }, async () => {
    let calls = 0
    const [tool] = wrapToolsWithResilience([
      toolWith('demo_tool', async () => {
        calls += 1
        throw new Error('validation failed')
      }),
    ])
    await assert.rejects(() => tool.callback({}), /validation failed/)
    assert.equal(calls, 1)
  })
})

test('fails when a tool exceeds its timeout', async () => {
  await withEnv({ TOOL_TIMEOUT_MS: '40', TOOL_MAX_RETRIES: '0', TOOL_BREAKER_ENABLED: 'false' }, async () => {
    const [tool] = wrapToolsWithResilience([
      toolWith('demo_tool', () => new Promise((resolve) => setTimeout(() => resolve('late'), 300))),
    ])
    await assert.rejects(() => tool.callback({}), /timed out after 40ms/)
  })
})

test('opens the circuit breaker after repeated transient failures', async () => {
  await withEnv({
    TOOL_TIMEOUT_MS: '1000',
    TOOL_MAX_RETRIES: '0',
    TOOL_BACKOFF_MS: '0',
    TOOL_BREAKER_ENABLED: 'true',
    TOOL_BREAKER_FAILURE_THRESHOLD: '2',
    TOOL_BREAKER_FAILURE_WINDOW_MS: '60000',
    TOOL_BREAKER_COOLDOWN_MS: '60000',
  }, async () => {
    let calls = 0
    const [tool] = wrapToolsWithResilience([
      toolWith('demo_tool', async () => {
        calls += 1
        throw new Error('503 service unavailable')
      }),
    ])
    await assert.rejects(() => tool.callback({}), /503/)
    await assert.rejects(() => tool.callback({}), /503/)
    const blocked = await tool.callback({})
    assert.match(String(blocked), /temporarily unavailable/)
    assert.equal(calls, 2)
  })
})

test('strict mode fails startup when a tool has no callback', async () => {
  await withEnv({ TOOL_RESILIENCE_STRICT: 'true' }, async () => {
    assert.throws(
      () => wrapToolsWithResilience([{ name: 'broken_tool' }]),
      /TOOL_RESILIENCE_STRICT/,
    )
  })
})
