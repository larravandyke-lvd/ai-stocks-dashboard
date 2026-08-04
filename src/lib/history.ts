// Server-only historical price series.
//
// WHY THIS EXISTS
// The build spec called for Finnhub `/stock/candle`. That endpoint is
// paywalled on the free tier (verified: 403 "You don't have access to this
// resource"), and it is what the price chart, the lot markers and the
// SPY/QQQ benchmark overlay all depend on. Stooq was evaluated as a
// replacement and rejected — it now sits behind a JavaScript proof-of-work
// bot wall that a server-side fetch cannot clear.
//
// Yahoo's chart endpoint is the fallback in use. It is free, keyless, and
// returned clean daily bars for all seven holdings plus SPY and QQQ. It is
// also UNDOCUMENTED: no SLA, no support, and it can rate-limit or change
// shape without notice. Every function here is therefore best-effort and
// returns null on failure so the surrounding page degrades to
// "chart unavailable" instead of throwing.

import 'server-only'

const CHART_ROOT = 'https://query1.finance.yahoo.com/v8/finance/chart'

// The User-Agent below is load-bearing and deliberately minimal.
//
// Do not "improve" it into a realistic browser string. Measured against the
// live endpoint: a bare `Mozilla/5.0` returns 200 on every attempt, while a
// full Chrome UA — and sending no UA at all — both return 429 on query1 and
// query2 alike. It is not rate limiting; it reproduces from a cold client on
// the first request. A complete browser UA that arrives without the matching
// TLS fingerprint and cookies apparently looks more like a scraper to Yahoo
// than a generic client does.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json',
}

const CACHE_TTL_MS = 15 * 60_000
const cache = new Map<string, { at: number; value: PriceSeries | null }>()

export type PricePoint = {
  /** `YYYY-MM-DD` in US market time. */
  date: string
  close: number
}

export type PriceSeries = {
  symbol: string
  points: PricePoint[]
}

function toMarketDate(unixSec: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSec * 1000))
}

/**
 * Daily closes for a symbol.
 *
 * Pass `fromIso` to start the series at a specific date (used for
 * "since first purchase"); otherwise `range` applies.
 */
export async function fetchPriceSeries(
  symbol: string,
  options: { fromIso?: string; range?: string } = {}
): Promise<PriceSeries | null> {
  const upper = symbol.toUpperCase()
  const cacheKey = `${upper}|${options.fromIso || ''}|${options.range || ''}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value

  const url = new URL(`${CHART_ROOT}/${encodeURIComponent(upper)}`)
  url.searchParams.set('interval', '1d')

  if (options.fromIso) {
    const start = Date.parse(`${options.fromIso.slice(0, 10)}T00:00:00Z`)
    if (!Number.isNaN(start)) {
      url.searchParams.set('period1', String(Math.floor(start / 1000)))
      url.searchParams.set('period2', String(Math.floor(Date.now() / 1000)))
    } else {
      url.searchParams.set('range', options.range || '1y')
    }
  } else {
    url.searchParams.set('range', options.range || '1y')
  }

  let series: PriceSeries | null = null
  try {
    let res: Response | null = null

    // One retry, only for 429. Several holdings plus two benchmarks fan out at
    // once on the detail page, so a burst can still get throttled even with
    // the right User-Agent. Anything else fails straight through — retrying a
    // 404 just doubles the latency before the same empty chart.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      res = await fetch(url.toString(), {
        headers: HEADERS,
        cache: 'no-store',
        // Yahoo occasionally hangs rather than erroring. A slow chart must not
        // hold the whole page render hostage.
        signal: AbortSignal.timeout(8000),
      })
      if (res.status !== 429) break
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600))
    }

    if (!res || !res.ok) throw new Error(`Yahoo returned ${res?.status ?? 'nothing'}`)

    const data = (await res.json()) as {
      chart?: {
        result?: {
          timestamp?: number[]
          indicators?: { quote?: { close?: (number | null)[] }[] }
        }[]
        error?: unknown
      }
    }

    const result = data.chart?.result?.[0]
    const stamps = result?.timestamp
    const closes = result?.indicators?.quote?.[0]?.close

    if (Array.isArray(stamps) && Array.isArray(closes)) {
      const points: PricePoint[] = []
      for (let i = 0; i < stamps.length; i += 1) {
        const close = closes[i]
        // Yahoo pads holidays and halts with nulls.
        if (typeof close === 'number' && Number.isFinite(close)) {
          points.push({ date: toMarketDate(stamps[i]), close })
        }
      }
      if (points.length > 0) series = { symbol: upper, points }
    }
  } catch (error) {
    console.error(`Price history unavailable for ${upper}`, error)
    series = null
  }

  cache.set(cacheKey, { at: Date.now(), value: series })
  return series
}

/** Fetch several series concurrently; individual failures come back as null. */
export async function fetchPriceSeriesMany(
  symbols: string[],
  options: { fromIso?: string; range?: string } = {}
): Promise<Record<string, PriceSeries | null>> {
  const entries = await Promise.all(
    symbols.map(
      async (symbol) =>
        [symbol.toUpperCase(), await fetchPriceSeries(symbol, options)] as const
    )
  )
  return Object.fromEntries(entries)
}

export const BENCHMARKS = ['SPY', 'QQQ'] as const
export type Benchmark = (typeof BENCHMARKS)[number]

/**
 * Rebase a series to percent change from its first point, so a $275 stock and
 * a $600 index can share one axis.
 */
export function toPercentChange(
  points: PricePoint[]
): { date: string; value: number }[] {
  if (points.length === 0) return []
  const base = points[0].close
  if (!base) return []
  return points.map((point) => ({
    date: point.date,
    value: (point.close - base) / base,
  }))
}
