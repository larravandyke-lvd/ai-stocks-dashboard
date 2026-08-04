// GET  — earnings rows stored in Airtable, optionally for one ticker.
// POST — refresh from Finnhub's earnings calendar and upsert into Airtable.

import { createRecords, listRecords, updateRecord } from '@/lib/airtable'
import { EARNINGS, HOLDINGS, readText } from '@/lib/airtable-schema'
import { fetchEarnings } from '@/lib/finnhub'
import { errorResponse } from '@/lib/http-error'
import { mapEarnings } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const ticker = new URL(request.url).searchParams.get('ticker')

    const records = await listRecords('earnings', {
      sort: [{ fieldId: EARNINGS.reportDate, direction: 'desc' }],
    })
    let earnings = records.map(mapEarnings)

    if (ticker) {
      const upper = ticker.toUpperCase()
      const holdings = await listRecords('holdings')
      const match = holdings.find(
        (record) => readText(record.fields[HOLDINGS.ticker]).toUpperCase() === upper
      )
      earnings = match
        ? earnings.filter((row) => row.holdingIds.includes(match.id))
        : []
    }

    return Response.json({ earnings })
  } catch (error) {
    return errorResponse(error)
  }
}

/**
 * Refresh from Finnhub. Idempotent: rows are keyed `TICKER YYYY-Qn`, so a
 * re-run updates the estimate that became an actual rather than appending a
 * duplicate quarter.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { ticker?: string }

    const holdingRecords = await listRecords('holdings')
    const targets = holdingRecords
      .map((record) => ({
        id: record.id,
        ticker: readText(record.fields[HOLDINGS.ticker]).toUpperCase(),
      }))
      .filter((entry) => entry.ticker)
      .filter((entry) =>
        body.ticker ? entry.ticker === body.ticker.toUpperCase() : true
      )

    if (targets.length === 0) {
      return Response.json({ error: 'No matching holding.' }, { status: 404 })
    }

    const existing = await listRecords('earnings')
    const byKey = new Map(
      existing.map((record) => [readText(record.fields[EARNINGS.key]), record])
    )

    const created: string[] = []
    const updated: string[] = []

    for (const target of targets) {
      let rows
      try {
        rows = await fetchEarnings(target.ticker)
      } catch (error) {
        console.error(`Earnings fetch failed for ${target.ticker}`, error)
        continue
      }

      const pending: Record<string, unknown>[] = []

      for (const row of rows) {
        if (!row.date) continue

        const quarter =
          row.year && row.quarter ? `${row.year}-Q${row.quarter}` : row.date
        const key = `${target.ticker} ${quarter}`

        const surprisePct =
          row.epsActual !== null && row.epsEstimate !== null && row.epsEstimate !== 0
            ? (row.epsActual - row.epsEstimate) / Math.abs(row.epsEstimate)
            : null

        const hour = row.hour.toLowerCase()
        const fields: Record<string, unknown> = {
          [EARNINGS.key]: key,
          [EARNINGS.ticker]: [target.id],
          [EARNINGS.reportDate]: row.date,
          [EARNINGS.epsEstimate]: row.epsEstimate,
          [EARNINGS.epsActual]: row.epsActual,
          [EARNINGS.revenueEstimate]: row.revenueEstimate,
          [EARNINGS.revenueActual]: row.revenueActual,
          [EARNINGS.surprisePct]: surprisePct,
        }

        // Finnhub leaves `hour` empty for reports it has not scheduled yet.
        // Writing an empty string into a single-select would fail.
        if (hour === 'bmo' || hour === 'amc') {
          fields[EARNINGS.time] = hour.toUpperCase()
        }

        const match = byKey.get(key)
        if (match) {
          await updateRecord('earnings', match.id, fields)
          updated.push(key)
        } else {
          pending.push(fields)
          created.push(key)
        }
      }

      if (pending.length > 0) await createRecords('earnings', pending)
    }

    return Response.json({
      refreshed: targets.map((target) => target.ticker),
      created: created.length,
      updated: updated.length,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
