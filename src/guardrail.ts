/**
 * Guardrail: Check tool inputs for sensitive data before execution.
 * Blocks any tool call that contains PII or sensitive information.
 */

const SENSITIVE_PATTERNS = [
  // Credit card numbers (13-19 digits)
  /\b(?:\d[ -]*?){13,19}\b/,
  // Hong Kong ID
  /[A-Z]{1,2}\d{6}[0-9A]/i,
  // Email addresses
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,
  // Phone numbers (various formats)
  /(?:\+?\d{1,4}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/,
  // SSN / US social security
  /\b\d{3}-\d{2}-\d{4}\b/,
  // Passport numbers
  /\b[A-Z]{1,2}\d{6,9}\b/,
  // API keys / tokens (long alphanumeric strings with dashes)
  /\b[a-zA-Z0-9]{20,}[-_][a-zA-Z0-9]{10,}\b/,
  // Private keys
  /-----BEGIN.*PRIVATE KEY-----/,
  // Passwords in common formats
  /(?:password|passwd|pwd)\s*[:=]\s*\S+/i,
]

const SENSITIVE_KEYWORDS = [
  'password',
  'secret',
  'private key',
  'credit card',
  'bank account',
  'social security',
  'passport number',
  'id number',
  '身份證',
  '密碼',
  '銀行帳號',
  '信用卡',
]

/**
 * Check if text contains sensitive data.
 * Returns the type of sensitive data found, or null if clean.
 */
export function detectSensitiveData(text: string): string | null {
  // Whitelist: memory IDs and tool-related patterns
  const sanitized = text.replace(/mem_\d+/g, '').replace(/tooluse_[a-f0-9-]+/g, '')
  const lowerText = sanitized.toLowerCase()

  // Check keywords
  for (const keyword of SENSITIVE_KEYWORDS) {
    if (lowerText.includes(keyword.toLowerCase())) {
      return `contains sensitive keyword: "${keyword}"`
    }
  }

  // Check patterns
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(sanitized)) {
      return `matches sensitive pattern (possible PII)`
    }
  }

  return null
}

/**
 * Sanitize tool input - returns error message if blocked, null if safe.
 */
export function guardToolInput(toolName: string, input: Record<string, unknown>): string | null {
  const inputStr = JSON.stringify(input)
  const detected = detectSensitiveData(inputStr)

  if (detected) {
    console.warn(`🛡️ [guardrail] BLOCKED tool "${toolName}": ${detected}`)
    return `Blocked: I cannot send sensitive data to external tools. Input ${detected}.`
  }

  return null
}
