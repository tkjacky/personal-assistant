import assert from 'node:assert/strict'
import test from 'node:test'
import { detectSensitiveData, guardToolInput } from '../src/guardrail.ts'

test('allows an ordinary request', () => {
  assert.equal(detectSensitiveData('What is the weather in Hong Kong today?'), null)
})

test('blocks a password keyword', () => {
  const detected = detectSensitiveData('my password is hunter2')
  assert.ok(detected)
  assert.match(detected, /password/)
})

test('blocks an email address', () => {
  const detected = detectSensitiveData('reach me at user@example.com')
  assert.ok(detected)
  assert.match(detected, /PII/)
})

test('ignores memory ids and tool-use ids', () => {
  assert.equal(detectSensitiveData('please recall mem_1783420545072'), null)
  assert.equal(detectSensitiveData('retry tooluse_abc123-def456'), null)
})

test('guardToolInput blocks sensitive tool arguments', () => {
  assert.equal(guardToolInput('weather', { location: 'Hong Kong' }), null)
  const blocked = guardToolInput('web_search', { query: 'password: hunter2' })
  assert.ok(blocked)
  assert.match(blocked, /Blocked/)
})
