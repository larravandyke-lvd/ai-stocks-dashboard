// Server-only Finnhub client.
//
// Free-tier reality check, verified against the live key on 2026-08-04:
//   /quote                 200
//   /calendar/earnings     200
//   /stock/recommendation  200
//   /company-news          200
//   /stock/profile2        200
//   /stock/candle          403  ← paywalled
//
// Historical price series therefore do NOT come from here. See `history.ts`.

import 'server-only'

import { marketDate, marketDateDaysAgo } from './dates'
import { HttpError } from './http-error'

const API_ROOT = 'https://finnhub.io/api/v1'

/**
 * The free tier allows 60 calls/minute. A dashboard load touches ~7 quotes
 * plus a handful of per-stock endpoints, so the ceiling is not the constraint
 * — repeat loads within a minute are. A short in-process cache keeps a browser
 * refresh from re-billing the same quote. On serverless each instance keeps
 * its own copy, which is fine: the worst case is one extra call per instance.
 */
const CACHE_TTL_MS = 60_000
const cache = new Map<string, { at: number; value: unknown }>()

function requireKey(): string {
  const key = process.env.FINNHUB_API_KEY
  if (!key) {
    throw new HttpError(
      'FINNHUB_API_KEY is not set. Add it in Vercel project settings.',
      500
    )
  }
  return key
}

export function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY)
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  ttlMs = CACHE_TTL_MS
): Promise<T> {
  const key = requireKey()
  const url = new URL(`${API_ROOT}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)

  const cacheKey = url.toString()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T

  url.searchParams.set('token', key)

  const res = await fetch(url.toString(), { cache: 'no-store' })
  const text = await res.text()

  if (!res.ok) {
    // 403 here almost always means a premium endpoint, not a bad key.
    throw new HttpError(
      res.status === 403
        ? 'Finnhub denied this endpoint on the current plan.'
        : `Finnhub returned ${res.status}.`,
      res.status === 429 ? 429 : 502,
      text
    )
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new HttpError('Finnhub returned a malformed response.', 502, text)
  }

  cache.set(cacheKey, { at: Date.now(), value: data })
  return data as T
}

export type Quote = {
  /** Last price. */
  price: number | null
  /** Absolute day change in dollars. */
  change: number | null
  /** Day change as a FRACTION (0.0412), not Finnhub's raw percent (4.12). */
  changePct: number | null
  high: number | null
  low: number | null
  open: number | null
  previousClose: number | null
  at: number | null
}

type RawQuote = {
  c?: number
  d?: number
  dp?: number
  h?: number
  l?: number
  o?: number
  pc?: number
  t?: number
}

function finite(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export async function fetchQuote(symbol: string): Promise<Quote> {
  const raw = await get<RawQuote>('/quote', { symbol: symbol.toUpperCase() })
  const dp = finite(raw.dp)
  return {
    price: finite(raw.c),
    change: finite(raw.d),
    // Normalised to a fraction so it can flow straight into an Airtable
    // percent field and into `percent()` without a second conversion.
    changePct: dp === null ? null : dp / 100,
    high: finite(raw.h),
    low: finite(raw.l),
    open: finite(raw.o),
    previousClose: finite(raw.pc),
    at: finite(raw.t),
  }
}

/** Quote several symbols, tolerating individual failures. */
export async function fetchQuotes(
  symbols: string[]
): Promise<Record<string, Quote>> {
  const entries = await Promise.all(
    symbols.map(async (symbol) => {
      try {
        return [symbol, await fetchQuote(symbol)] as const
      } catch (error) {
        console.error(`Finnhub quote failed for ${symbol}`, error)
        return [symbol, null] as const
      }
    })
  )

  const out: Record<string, Quote> = {}
  for (const [symbol, quote] of entries) {
    if (quote) out[symbol] = quote
  }
  return out
}

export type EarningsRow = {
  symbol: string
  date: string
  hour: string
  quarter: number | null
  year: number | null
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
}

/**
 * Earnings history and upcoming reports for one symbol.
 *
 * Finnhub answers with a window, so this asks for a wide one: two years back
 * for history, a year forward for the next scheduled report.
 */
export async function fetchEarnings(symbol: string): Promise<EarningsRow[]> {
  const data = await get<{ earningsCalendar?: unknown[] }>(
    '/calendar/earnings',
    {
      symbol: symbol.toUpperCase(),
      from: marketDateDaysAgo(730),
      to: marketDateDaysAgo(-365),
    },
    // Earnings move rarely; a longer TTL saves calls on repeat page views.
    15 * 60_000
  )

  const rows = Array.isArray(data.earningsCalendar) ? data.earningsCalendar : []
  return rows.map((entry) => {
    const row = entry as Record<string, unknown>
    const num = (key: string) => finite(row[key] as number | undefined)
    return {
      symbol: String(row.symbol ?? symbol).toUpperCase(),
      date: String(row.date ?? ''),
      hour: String(row.hour ?? ''),
      quarter: num('quarter'),
      year: num('year'),
      epsEstimate: num('epsEstimate'),
      epsActual: num('epsActual'),
      revenueEstimate: num('revenueEstimate'),
      revenueActual: num('revenueActual'),
    }
  })
}

export type Recommendation = {
  period: string
  strongBuy: number
  buy: number
  hold: number
  sell: number
  strongSell: number
}

export async function fetchRecommendations(
  symbol: string
): Promise<Recommendation[]> {
  const data = await get<unknown[]>(
    '/stock/recommendation',
    { symbol: symbol.toUpperCase() },
    15 * 60_000
  )
  if (!Array.isArray(data)) return []
  return data.map((entry) => {
    const row = entry as Record<string, unknown>
    const int = (key: string) => finite(row[key] as number | undefined) ?? 0
    return {
      period: String(row.period ?? ''),
      strongBuy: int('strongBuy'),
      buy: int('buy'),
      hold: int('hold'),
      sell: int('sell'),
      strongSell: int('strongSell'),
    }
  })
}

export type NewsItem = {
  id: number
  headline: string
  summary: string
  source: string
  url: string
  datetime: number
}

export async function fetchNews(symbol: string, days = 14): Promise<NewsItem[]> {
  const data = await get<unknown[]>(
    '/company-news',
    {
      symbol: symbol.toUpperCase(),
      from: marketDateDaysAgo(days),
      to: marketDate(),
    },
    10 * 60_000
  )
  if (!Array.isArray(data)) return []
  return data
    .map((entry) => {
      const row = entry as Record<string, unknown>
      return {
        id: finite(row.id as number | undefined) ?? 0,
        headline: String(row.headline ?? ''),
        summary: String(row.summary ?? ''),
        source: String(row.source ?? ''),
        url: String(row.url ?? ''),
        datetime: finite(row.datetime as number | undefined) ?? 0,
      }
    })
    .filter((item) => item.headline && item.url)
    .sort((a, b) => b.datetime - a.datetime)
}

export type Profile = {
  name: string
  ticker: string
  exchange: string
  industry: string
  logo: string
  weburl: string
  marketCap: number | null
  ipo: string
}

export async function fetchProfile(symbol: string): Promise<Profile | null> {
  const row = await get<Record<string, unknown>>(
    '/stock/profile2',
    { symbol: symbol.toUpperCase() },
    60 * 60_000
  )
  if (!row || !row.ticker) return null
  return {
    name: String(row.name ?? ''),
    ticker: String(row.ticker ?? symbol).toUpperCase(),
    exchange: String(row.exchange ?? ''),
    industry: String(row.finnhubIndustry ?? ''),
    logo: String(row.logo ?? ''),
    weburl: String(row.weburl ?? ''),
    // Finnhub reports market cap in millions.
    marketCap: (() => {
      const raw = finite(row.marketCapitalization as number | undefined)
      return raw === null ? null : raw * 1_000_000
    })(),
    ipo: String(row.ipo ?? ''),
  }
}

/** Best-effort variants — a failed sidebar should not blank the page. */
export async function tryFetch<T>(
  work: () => Promise<T>,
  fallback: T,
  label: string
): Promise<T> {
  try {
    return await work()
  } catch (error) {
    console.error(`${label} failed`, error)
    return fallback
  }
}
