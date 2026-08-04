// Shared auth helpers. Must stay Edge-runtime safe — `middleware.ts` imports
// this, and middleware cannot use node:crypto. Web Crypto only, no Node APIs.

export const AUTH_COOKIE = 'ai_stocks_auth'

/** 30 days. Long enough not to nag, short enough to expire on a stale device. */
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30

/**
 * The cookie value is an HMAC over a fixed string, keyed by the password.
 *
 * Deriving it from the password rather than storing a random session id means
 * there is no session table to keep, and changing DASHBOARD_PASSWORD
 * immediately invalidates every existing cookie. The password itself is never
 * sent to the browser.
 */
export async function authToken(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode('ai-stocks-dashboard.v1')
  )

  // base64url, so the value is cookie-safe without escaping.
  let binary = ''
  const bytes = new Uint8Array(signature)
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Constant-time string comparison.
 *
 * `a === b` short-circuits at the first differing byte, which leaks how much
 * of a guess was correct through response timing. The window is small over a
 * network, but comparing secrets in variable time is not worth the argument.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
