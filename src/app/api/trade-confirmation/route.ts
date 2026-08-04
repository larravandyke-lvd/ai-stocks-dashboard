// Trade-confirmation intake.
//
// Two-phase on purpose. `parse` extracts trades from an uploaded PDF or image
// and returns them WITHOUT writing anything; `commit` takes the fields the
// user confirmed in the browser and writes them to Airtable. A parser that
// wrote straight to the base would silently file a misread share count or
// price into the cost basis, and nothing downstream would catch it.

import Anthropic from '@anthropic-ai/sdk'

import { createRecords, listRecords } from '@/lib/airtable'
import { anthropicError } from '@/lib/anthropic-errors'
import { HOLDINGS, LOTS, ORDERS, readText } from '@/lib/airtable-schema'
import { errorResponse, HttpError } from '@/lib/http-error'

export const dynamic = 'force-dynamic'
// Parsing a multi-page PDF can take a while; the Next.js default would cut it off.
export const maxDuration = 120

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024

const ACCEPTED = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/**
 * Structured output schema. Assistant prefill — the old way of forcing JSON —
 * returns a 400 on current models, so the shape is constrained here instead.
 * Every object needs `additionalProperties: false` and a complete `required`
 * list, so optional values are typed as nullable rather than omitted.
 */
const TRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documentType', 'confidence', 'trades'],
  properties: {
    documentType: {
      type: 'string',
      description: 'What the document appears to be, e.g. "Fidelity trade confirmation".',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'How confident you are that the extracted values are correct.',
    },
    trades: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'action',
          'state',
          'ticker',
          'shares',
          'pricePerShare',
          'fees',
          'tradeDate',
          'account',
          'broker',
          'limitPrice',
          'expires',
          'notes',
        ],
        properties: {
          action: { type: 'string', enum: ['Buy', 'Sell'] },
          state: {
            type: 'string',
            enum: ['Filled', 'Open'],
            description:
              'Filled if the trade executed. Open if this is a resting/working order that has not executed yet.',
          },
          ticker: { type: 'string', description: 'Ticker symbol, uppercase.' },
          shares: { type: 'number', description: 'Quantity of shares.' },
          pricePerShare: {
            type: ['number', 'null'],
            description: 'Execution price per share. Null for an unfilled order.',
          },
          fees: {
            type: ['number', 'null'],
            description: 'Commission and fees in dollars. Null if not shown.',
          },
          tradeDate: {
            type: ['string', 'null'],
            description: 'Trade date as YYYY-MM-DD. Use the trade date, not the settlement date.',
          },
          account: {
            type: ['string', 'null'],
            description: 'Account name or type, e.g. "IRA" or "Personal". Null if not shown.',
          },
          broker: {
            type: ['string', 'null'],
            description: 'Brokerage name. Null if not shown.',
          },
          limitPrice: {
            type: ['number', 'null'],
            description: 'Limit price, for an open order. Null otherwise.',
          },
          expires: {
            type: ['string', 'null'],
            description: 'Order expiry as YYYY-MM-DD, for an open order. Null otherwise.',
          },
          notes: {
            type: ['string', 'null'],
            description: 'Anything else worth recording. Null if nothing stands out.',
          },
        },
      },
    },
  },
} as const

const SYSTEM_PROMPT = `You extract stock trade details from brokerage confirmations.

Read only what the document actually states. Never infer, estimate, or fill in a
plausible-looking value for something the document does not show — return null
instead. A null is correctable by the person reviewing; an invented number looks
correct and silently corrupts their cost basis.

Specifics:
- Use the TRADE date, not the settlement date.
- "shares" is the quantity, "pricePerShare" the per-share execution price. If the
  document shows only a total principal amount, divide it by the share count and
  say so in notes.
- Fractional share quantities are normal — report them exactly, do not round.
- A confirmation may list several trades. Return one entry per trade.
- Mark a trade "Open" only when the document shows a working or resting order
  that has not executed. A completed execution is "Filled".
- Set confidence to "low" if the document is hard to read or ambiguous.`

type ParsedTrade = {
  action: 'Buy' | 'Sell'
  state: 'Filled' | 'Open'
  ticker: string
  shares: number
  pricePerShare: number | null
  fees: number | null
  tradeDate: string | null
  account: string | null
  broker: string | null
  limitPrice: number | null
  expires: string | null
  notes: string | null
}

function anthropic(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new HttpError(
      'ANTHROPIC_API_KEY is not set. Add it in Vercel project settings to use the uploader.',
      500
    )
  }
  return new Anthropic({ apiKey })
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || ''

    // `commit` arrives as JSON, `parse` as multipart. One route, because the
    // browser flow is a single component and this keeps its wiring obvious.
    if (contentType.includes('application/json')) {
      return await commit(request)
    }
    return await parse(request)
  } catch (error) {
    return errorResponse(error)
  }
}

async function parse(request: Request): Promise<Response> {
  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    throw new HttpError('No file was uploaded.', 400)
  }
  if (file.size === 0) {
    throw new HttpError('That file is empty.', 400)
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new HttpError('That file is larger than 10 MB.', 413)
  }
  if (!ACCEPTED.has(file.type)) {
    throw new HttpError(
      `Unsupported file type "${file.type || 'unknown'}". Upload a PDF or an image.`,
      415
    )
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  const block =
    file.type === 'application/pdf'
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: 'application/pdf' as const,
            data: base64,
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: file.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
            data: base64,
          },
        }

  let message
  try {
    message = await anthropic().messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      // Extraction is well-specified, so the deeper reasoning tiers buy nothing
      // here — they only add latency to a person waiting on an upload.
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: TRADE_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            block,
            {
              type: 'text',
              text: 'Extract every trade from this confirmation.',
            },
          ],
        },
      ],
    })
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw anthropicError(error, 'Reading the confirmation')
  }

  // Safety classifiers answer with HTTP 200 and stop_reason "refusal", so this
  // has to be checked before touching content.
  if (message.stop_reason === 'refusal') {
    throw new HttpError('The document could not be processed.', 422)
  }
  if (message.stop_reason === 'max_tokens') {
    throw new HttpError(
      'The document was too long to parse in one pass. Try uploading fewer pages.',
      422
    )
  }

  const text = message.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text') {
    throw new HttpError('The parser returned no result.', 502)
  }

  let parsed: { documentType?: string; confidence?: string; trades?: ParsedTrade[] }
  try {
    parsed = JSON.parse(text.text)
  } catch {
    throw new HttpError('The parser returned malformed output.', 502)
  }

  const trades = (parsed.trades || []).map((trade) => ({
    ...trade,
    ticker: (trade.ticker || '').toUpperCase().trim(),
  }))

  return Response.json({
    documentType: parsed.documentType || 'Trade confirmation',
    confidence: parsed.confidence || 'low',
    trades,
    filename: file.name,
  })
}

type CommitBody = {
  trades?: ParsedTrade[]
}

async function commit(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as CommitBody
  const trades = Array.isArray(body.trades) ? body.trades : []

  if (trades.length === 0) {
    throw new HttpError('No trades were submitted.', 400)
  }

  const holdings = await listRecords('holdings')
  const byTicker = new Map(
    holdings.map((record) => [
      readText(record.fields[HOLDINGS.ticker]).toUpperCase(),
      record.id,
    ])
  )

  const lotRows: Record<string, unknown>[] = []
  const orderRows: Record<string, unknown>[] = []
  const unknown: string[] = []

  for (const trade of trades) {
    const ticker = (trade.ticker || '').toUpperCase().trim()
    const holdingId = byTicker.get(ticker)

    // Refuse rather than inventing a Holdings row — a typo'd ticker would
    // otherwise create a phantom position that quietly skews the totals.
    if (!holdingId) {
      unknown.push(ticker || '(blank)')
      continue
    }

    if (trade.state === 'Open') {
      orderRows.push({
        [ORDERS.ticker]: [holdingId],
        [ORDERS.orderType]: trade.action,
        [ORDERS.quantity]: trade.shares,
        [ORDERS.limitPrice]: trade.limitPrice ?? trade.pricePerShare,
        [ORDERS.orderEntered]: trade.tradeDate,
        [ORDERS.expires]: trade.expires,
        [ORDERS.status]: 'Open',
        ...(trade.account ? { [ORDERS.account]: trade.account } : {}),
        ...(trade.broker ? { [ORDERS.broker]: trade.broker } : {}),
        [ORDERS.notes]: trade.notes || 'Logged from an uploaded confirmation.',
      })
    } else {
      lotRows.push({
        [LOTS.ticker]: [holdingId],
        [LOTS.purchaseDate]: trade.tradeDate,
        [LOTS.shares]: trade.shares,
        [LOTS.pricePerShare]: trade.pricePerShare,
        [LOTS.fees]: trade.fees ?? 0,
        [LOTS.status]: trade.action === 'Sell' ? 'Sold' : 'Open',
        ...(trade.account ? { [LOTS.account]: trade.account } : {}),
        ...(trade.broker ? { [LOTS.broker]: trade.broker } : {}),
        [LOTS.notes]: trade.notes || 'Logged from an uploaded confirmation.',
      })
    }
  }

  // typecast lets Airtable accept a broker or account string that is not yet a
  // choice on the select — and CREATES it. That is the intent here (a new
  // brokerage should not be a hard failure), but it does mean a misspelling
  // becomes a permanent select option until someone tidies the base.
  const createdLots = await createRecords('lots', lotRows, { typecast: true })
  const createdOrders = await createRecords('orders', orderRows, { typecast: true })

  return Response.json({
    lots: createdLots.length,
    orders: createdOrders.length,
    skipped: unknown,
  })
}
