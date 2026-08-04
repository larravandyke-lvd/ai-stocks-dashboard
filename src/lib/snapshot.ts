// Snapshot-on-load: writes one Stock Snapshot row per held ticker per trading
// day, triggered by a dashboard page load rather than by a cron job.
//
// This is a deliberate tradeoff, chosen over a scheduled job: history only
// accumulates from the day this shipped, and only on days the dashboard is
// actually opened. A week away from the app is a week of gaps in the chart.
//
// Must be called from a server component or route handler. Calling it from the
// client would let an ad blocker, a prefetch, or a bfcache restore either skip
// the write or fire it twice.

import 'server-only'

import { createRecords, listRecords, quoteFormulaValue } from './airtable'
import { STOCK_SNAPSHOT } from './airtable-schema'
import { marketDate } from './dates'
import type { Holding } from './portfolio'

export type SnapshotResult = {
  date: string
  written: string[]
  skipped: string[]
  error: string | null
}

/**
 * Concurrent loads would otherwise each see "no row yet" and each write one.
 * Sharing a single in-flight promise per date collapses them within an
 * instance. Across instances the existence check still races, which is why the
 * `Key` column exists — duplicates are detectable and harmless rather than
 * silently doubling a day.
 */
let inFlight: { date: string; work: Promise<SnapshotResult> } | null = null

export async function ensureTodaySnapshots(
  holdings: Holding[]
): Promise<SnapshotResult> {
  const date = marketDate()

  if (inFlight && inFlight.date === date) return inFlight.work

  const work = writeSnapshots(holdings, date).finally(() => {
    if (inFlight && inFlight.date === date) inFlight = null
  })

  inFlight = { date, work }
  return work
}

async function writeSnapshots(
  holdings: Holding[],
  date: string
): Promise<SnapshotResult> {
  const result: SnapshotResult = { date, written: [], skipped: [], error: null }

  // Only positions actually held, and only when a live price arrived. Writing
  // a row with a null price would poison the P/L chart with a phantom zero.
  const eligible = holdings.filter(
    (holding) =>
      holding.totalShares > 0 &&
      holding.price !== null &&
      Number.isFinite(holding.price)
  )

  if (eligible.length === 0) return result

  try {
    const keys = eligible.map((holding) => `${holding.ticker} ${date}`)

    // Match on the exact key rather than on `TODAY()`. Airtable evaluates
    // TODAY() in UTC, which after 8pm ET is already tomorrow — the check would
    // miss the row it just wrote and write a second one.
    const formula = `OR(${keys
      .map((key) => `{Key}=${quoteFormulaValue(key)}`)
      .join(',')})`

    const existing = await listRecords('stockSnapshot', {
      filterByFormula: formula,
    })

    const seen = new Set(
      existing
        .map((record) => record.fields[STOCK_SNAPSHOT.key])
        .filter((value): value is string => typeof value === 'string')
    )

    const rows: Record<string, unknown>[] = []

    for (const holding of eligible) {
      const key = `${holding.ticker} ${date}`
      if (seen.has(key)) {
        result.skipped.push(holding.ticker)
        continue
      }

      rows.push({
        [STOCK_SNAPSHOT.key]: key,
        [STOCK_SNAPSHOT.ticker]: [holding.id],
        [STOCK_SNAPSHOT.date]: date,
        [STOCK_SNAPSHOT.price]: holding.price,
        [STOCK_SNAPSHOT.marketValue]: holding.marketValue,
        [STOCK_SNAPSHOT.pl]: holding.unrealizedPl,
        // Airtable percent fields store a fraction, and `unrealizedPlPct` is
        // already one. Multiplying by 100 here would render 1200%.
        [STOCK_SNAPSHOT.plPct]: holding.unrealizedPlPct,
      })
      result.written.push(holding.ticker)
    }

    if (rows.length > 0) await createRecords('stockSnapshot', rows)
  } catch (error) {
    // A snapshot failure must never take the dashboard down with it.
    result.error = error instanceof Error ? error.message : 'Snapshot write failed.'
    result.written = []
    console.error('Stock Snapshot write failed', error)
  }

  return result
}
