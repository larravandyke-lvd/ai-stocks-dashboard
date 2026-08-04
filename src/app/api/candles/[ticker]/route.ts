// Historical daily closes.
//
// Named `/candles` to match the original build spec, but it does NOT proxy
// Finnhub `/stock/candle` — that endpoint is paywalled on the free tier and
// returns 403. Data comes from `lib/history.ts` instead. Response shape is
// deliberately simple (`{date, close}[]`) rather than Finnhub's parallel-array
// `{t, c, o, h, l}` format, since nothing here charts intraday OHLC.

import { fetchPriceSeries } from '@/lib/history'
import { errorResponse } from '@/lib/http-error'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: { ticker: string } }
) {
  try {
    const symbol = params.ticker.toUpperCase()
    if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
      return Response.json({ error: 'Invalid ticker.' }, { status: 400 })
    }

    const search = new URL(request.url).searchParams
    const from = search.get('from') || undefined
    const range = search.get('range') || undefined

    const series = await fetchPriceSeries(symbol, { fromIso: from, range })

    if (!series) {
      // Upstream is undocumented and may rate-limit. Say so plainly instead of
      // returning an empty array that a chart would render as a flat line.
      return Response.json(
        { symbol, points: [], error: 'Price history is temporarily unavailable.' },
        { status: 503 }
      )
    }

    return Response.json({ symbol, points: series.points })
  } catch (error) {
    return errorResponse(error)
  }
}
