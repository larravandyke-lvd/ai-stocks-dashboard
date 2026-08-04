// Turns Anthropic SDK errors into messages worth showing a person.
//
// The SDK's raw `message` for a 4xx is the upstream JSON body. Passing that
// through produces a wall of escaped JSON in the UI, which reads as "the app
// broke" when the actual cause — no credits, wrong key, rate limited — is
// something specific and fixable.
//
// Note the base class is `APIError`, not `APIStatusError` (that is the Python
// SDK's name for it). Order these most-specific first: the typed subclasses
// all extend `APIError`, so a leading `APIError` branch would swallow them.

import Anthropic from '@anthropic-ai/sdk'

import { HttpError } from './http-error'

export function anthropicError(error: unknown, what: string): HttpError {
  if (error instanceof Anthropic.AuthenticationError) {
    return new HttpError(
      'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in the Vercel project settings.',
      503
    )
  }

  if (error instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(
      'The Anthropic API key does not have permission for this request.',
      503
    )
  }

  if (error instanceof Anthropic.RateLimitError) {
    return new HttpError(
      `Anthropic is rate limiting requests. ${what} again in a moment.`,
      429
    )
  }

  if (error instanceof Anthropic.APIError) {
    const status = typeof error.status === 'number' ? error.status : 502

    // Running out of credit arrives as a 400, not a 402, so status alone
    // cannot separate it from a malformed request — the body has to be read.
    const body = JSON.stringify(error.error ?? '') + ' ' + (error.message || '')
    if (/credit balance|billing|insufficient|quota/i.test(body)) {
      return new HttpError(
        'The Anthropic account is out of credit. Add credits under Plans & Billing at console.anthropic.com, then try again.',
        503
      )
    }

    if (status >= 500) {
      return new HttpError(
        `Anthropic is temporarily unavailable. ${what} again shortly.`,
        503
      )
    }

    return new HttpError(`Anthropic rejected the request (${status}).`, 502)
  }

  if (error instanceof Anthropic.APIConnectionError) {
    return new HttpError('Could not reach the Anthropic API.', 503)
  }

  return new HttpError(
    error instanceof Error ? error.message : `${what} failed.`,
    500
  )
}
