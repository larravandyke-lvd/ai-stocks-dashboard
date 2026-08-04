// Finnhub quote proxy. Exists so FINNHUB_API_KEY stays server-side.

import { fetchQuote } from '@/lib/finnhub'
import { errorResponse } from '@/lib/http-error'

export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  { params }: { params: { ticker: string } }
) {
  try {
    const symbol = params.ticker.toUpperCase()
    if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
      return Response.json({ error: 'Invalid ticker.' }, { status: 400 })
    }
    return Response.json({ symbol, quote: await fetchQuote(symbol) })
  } catch (error) {
    return errorResponse(error)
  }
}
