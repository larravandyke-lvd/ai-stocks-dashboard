// Generates the plain-English "position read" for one holding and caches it.
//
// The cache lives in Airtable (Position Read / Position Read At on Holdings)
// rather than in process memory. Serverless instances are short-lived and not
// shared, so an in-memory cache would miss on nearly every visit and bill a
// fresh model call each time — exactly what the caching requirement is for.

import Anthropic from '@anthropic-ai/sdk'

import { listRecords, updateRecord } from '@/lib/airtable'
import { HOLDINGS } from '@/lib/airtable-schema'
import { formatDate, marketDate } from '@/lib/dates'
import { fetchNews, tryFetch } from '@/lib/finnhub'
import { errorResponse, HttpError } from '@/lib/http-error'
import { loadPortfolio, mapEarnings, mapLot } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

const SYSTEM_PROMPT = `You write a short "position read" for one stock in a private investor's portfolio.

Three to five sentences of plain English. No headings, no bullet points, no
preamble — just the paragraph.

Cover what is actually notable in the data you are given, which will usually be
some of:
- How large the position is relative to the whole portfolio, and whether that
  concentration is worth naming.
- The spread of cost basis across lots — averaging in, one big entry, buying
  into strength or into weakness.
- The earnings trend: beats or misses against estimates, and when the next
  report lands.
- What recent news actually implies for the position, if anything.

Rules:
- Use only the figures provided. Never estimate, extrapolate, or introduce a
  number that is not in the data.
- If something notable is absent — no earnings history, no news, a single lot —
  simply do not mention it. Do not narrate the absence.
- Describe what is true. Do not tell the investor to buy, sell, trim, or hold,
  and do not forecast a price.
- Write plainly, as a knowledgeable friend would. No hedging boilerplate, no
  "it is important to note", no disclaimers.`

function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new HttpError(
      'ANTHROPIC_API_KEY is not set. Add it in the Vercel project settings to enable the position read.',
      503
    )
  }
  return new Anthropic({ apiKey })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ticker?: string
      force?: boolean
    }

    const ticker = (body.ticker || '').toUpperCase().trim()
    if (!ticker) throw new HttpError('No ticker was supplied.', 400)

    const { holdings, totals } = await loadPortfolio()
    const holding = holdings.find((entry) => entry.ticker === ticker)
    if (!holding) throw new HttpError(`No holding found for ${ticker}.`, 404)

    // Serve the cache unless it is stale or a refresh was asked for.
    if (!body.force && holding.positionRead) {
      const writtenAt = Date.parse(holding.positionReadAt)
      const fresh =
        Number.isFinite(writtenAt) && Date.now() - writtenAt < STALE_AFTER_MS
      if (fresh) {
        return Response.json({
          read: holding.positionRead,
          generatedAt: holding.positionReadAt,
          cached: true,
        })
      }
    }

    const [lotRecords, earningsRecords, news] = await Promise.all([
      listRecords('lots'),
      listRecords('earnings'),
      tryFetch(() => fetchNews(ticker, 21), [], `News ${ticker}`),
    ])

    const lots = lotRecords
      .map(mapLot)
      .filter((lot) => lot.holdingIds.includes(holding.id))
      .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))

    const earnings = earningsRecords
      .map(mapEarnings)
      .filter((row) => row.holdingIds.includes(holding.id))
      .sort((a, b) => b.reportDate.localeCompare(a.reportDate))

    const today = marketDate()
    const upcoming = [...earnings].reverse().find((row) => row.reportDate >= today)
    const past = earnings.filter((row) => row.reportDate < today).slice(0, 6)

    const share =
      totals.marketValue > 0 && holding.marketValue !== null
        ? holding.marketValue / totals.marketValue
        : null

    // Everything the model is allowed to reason from, stated explicitly. It is
    // told not to introduce numbers, so anything missing here cannot appear.
    const facts = [
      `Ticker: ${holding.ticker} (${holding.companyName})`,
      holding.theme ? `Theme: ${holding.theme}` : null,
      `Shares held: ${holding.totalShares}`,
      `Average cost per share: ${fmt(holding.avgCostPerShare)}`,
      `Current price: ${fmt(holding.price)}`,
      `Cost basis: ${fmt(holding.totalCostBasis)}`,
      `Market value: ${fmt(holding.marketValue)}`,
      `Unrealized P/L: ${fmt(holding.unrealizedPl)} (${pct(holding.unrealizedPlPct)})`,
      share !== null
        ? `This position is ${(share * 100).toFixed(1)}% of the portfolio's total market value of ${fmt(totals.marketValue)}, across ${holdings.length} holdings.`
        : null,
      '',
      lots.length > 0
        ? `Lots (${lots.length}):\n` +
          lots
            .map(
              (lot) =>
                `- ${formatDate(lot.purchaseDate)}: ${lot.shares} shares at ${fmt(lot.pricePerShare)}${
                  lot.account ? ` (${lot.account})` : ''
                }`
            )
            .join('\n')
        : 'Lots: none recorded.',
      '',
      past.length > 0
        ? `Reported earnings (most recent first):\n` +
          past
            .map(
              (row) =>
                `- ${formatDate(row.reportDate)}: EPS ${
                  row.epsActual !== null ? row.epsActual.toFixed(2) : 'n/a'
                } vs ${
                  row.epsEstimate !== null ? row.epsEstimate.toFixed(2) : 'n/a'
                } estimate${
                  row.surprisePct !== null
                    ? ` (${(row.surprisePct * 100).toFixed(1)}% surprise)`
                    : ''
                }`
            )
            .join('\n')
        : 'Reported earnings: none recorded.',
      upcoming
        ? `Next earnings: ${formatDate(upcoming.reportDate)}${
            upcoming.time ? ` (${upcoming.time})` : ''
          }${
            upcoming.epsEstimate !== null
              ? `, consensus EPS estimate ${upcoming.epsEstimate.toFixed(2)}`
              : ''
          }. Not yet reported.`
        : 'Next earnings: no scheduled date recorded.',
      '',
      news.length > 0
        ? `Recent headlines:\n` +
          news
            .slice(0, 10)
            .map((item) => `- ${item.headline} (${item.source})`)
            .join('\n')
        : 'Recent headlines: none.',
    ]
      .filter((line) => line !== null)
      .join('\n')

    const message = await anthropic().messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: facts }],
    })

    if (message.stop_reason === 'refusal') {
      throw new HttpError('The position read could not be generated.', 422)
    }

    const block = message.content.find((entry) => entry.type === 'text')
    if (!block || block.type !== 'text') {
      throw new HttpError('The position read came back empty.', 502)
    }

    const read = block.text.trim()
    const generatedAt = new Date().toISOString()

    await updateRecord('holdings', holding.id, {
      [HOLDINGS.positionRead]: read,
      [HOLDINGS.positionReadAt]: generatedAt,
    })

    return Response.json({ read, generatedAt, cached: false })
  } catch (error) {
    return errorResponse(error)
  }
}

function fmt(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'unknown'
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function pct(fraction: number | null): string {
  if (fraction === null || !Number.isFinite(fraction)) return 'unknown'
  return `${(fraction * 100).toFixed(2)}%`
}
