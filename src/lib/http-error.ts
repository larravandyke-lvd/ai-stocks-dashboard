/** An error carrying the HTTP status a route should answer with. */
export class HttpError extends Error {
  readonly status: number
  readonly detail: string

  constructor(message: string, status = 500, detail = '') {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.detail = detail
  }
}

/**
 * Turn any thrown value into a JSON response.
 *
 * `detail` often contains an upstream error body, which for Airtable can echo
 * request context. It is logged, never returned.
 */
export function errorResponse(error: unknown): Response {
  const status = error instanceof HttpError ? error.status : 500
  const message =
    error instanceof Error ? error.message : 'Unexpected server error.'

  if (error instanceof HttpError && error.detail) {
    console.error(`[${status}] ${message}`, error.detail)
  } else {
    console.error(`[${status}] ${message}`)
  }

  return Response.json({ error: message }, { status })
}
