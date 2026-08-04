// Date helpers pinned to US market time.
//
// Everything date-shaped in this app is a *trading* date, so it has to be
// computed in America/New_York rather than in the server's zone. Vercel runs
// UTC: after 8pm ET, `new Date().toISOString().slice(0, 10)` is already
// tomorrow, which would file an evening snapshot under the wrong day and then
// skip the real one the next morning.

export const MARKET_TZ = 'America/New_York'

/** `YYYY-MM-DD` for the given instant in US market time. */
export function marketDate(at: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is the shape Airtable date fields want.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: MARKET_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at)
}

/** `YYYY-MM-DD`, `daysAgo` days before the given instant, in market time. */
export function marketDateDaysAgo(daysAgo: number, at: Date = new Date()): string {
  return marketDate(new Date(at.getTime() - daysAgo * 86_400_000))
}

/** Unix seconds — the unit Finnhub and Yahoo both use for timestamps. */
export function unixSeconds(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000)
}

/**
 * Render an ISO date for display without letting the browser's zone shift it.
 * `new Date('2026-08-04')` parses as UTC midnight, which in ET is Aug 3.
 */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)))
}

/** Whole days between two ISO dates. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(from) || Number.isNaN(to)) return 0
  return Math.round((to - from) / 86_400_000)
}
