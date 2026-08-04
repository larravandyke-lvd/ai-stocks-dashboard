'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'

// Nothing is written until the parsed values have been shown and confirmed.
// The parser is good but not infallible, and a wrong share count or price goes
// straight into the cost basis, where it is not obvious afterwards.

type Trade = {
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

type ParseResult = {
  documentType: string
  confidence: 'high' | 'medium' | 'low'
  trades: Trade[]
  filename: string
}

type Props = {
  holdings: { id: string; ticker: string }[]
}

export default function TradeConfirmationUpload({ holdings }: Props) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)

  const known = new Set(holdings.map((holding) => holding.ticker))

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    setDone(null)
    setResult(null)

    try {
      const body = new FormData()
      body.append('file', file)

      const res = await fetch('/api/trade-confirmation', { method: 'POST', body })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Could not read that file.')
      if (!data.trades || data.trades.length === 0) {
        throw new Error('No trades were found in that document.')
      }

      setResult(data as ParseResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    if (!result) return

    setBusy(true)
    setError(null)

    try {
      const res = await fetch('/api/trade-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trades: result.trades }),
      })
      const data = await res.json()

      if (!res.ok) throw new Error(data.error || 'Could not save to Airtable.')

      const parts: string[] = []
      if (data.lots) parts.push(`${data.lots} lot${data.lots === 1 ? '' : 's'}`)
      if (data.orders) {
        parts.push(`${data.orders} open order${data.orders === 1 ? '' : 's'}`)
      }

      let message = parts.length > 0 ? `Saved ${parts.join(' and ')}.` : 'Nothing was saved.'
      if (data.skipped?.length > 0) {
        message += ` Skipped ${data.skipped.join(', ')} — no matching holding in Airtable.`
      }

      setDone(message)
      setResult(null)
      // The page reads Airtable on the server, so a refresh is what surfaces
      // the new lot in the tables above.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  function edit(index: number, patch: Partial<Trade>) {
    if (!result) return
    const trades = result.trades.map((trade, i) =>
      i === index ? { ...trade, ...patch } : trade
    )
    setResult({ ...result, trades })
  }

  function numeric(value: string): number | null {
    if (value.trim() === '') return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return (
    <div>
      {error && <div className="notice error">{error}</div>}
      {done && <div className="notice ok">{done}</div>}

      {!result && (
        <>
          <button
            type="button"
            className={`dropzone${dragging ? ' dragging' : ''}`}
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              const file = event.dataTransfer.files?.[0]
              if (file) void upload(file)
            }}
          >
            {busy
              ? 'Reading the confirmation…'
              : 'Drop a trade confirmation here, or click to choose a file'}
            <div style={{ fontSize: 12.5, marginTop: 6, opacity: 0.75 }}>
              PDF or image, up to 10 MB
            </div>
          </button>

          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/gif,image/webp"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
              event.target.value = ''
            }}
          />
        </>
      )}

      {result && (
        <div className="parsed">
          <h3>
            {result.filename} · {result.trades.length} trade
            {result.trades.length === 1 ? '' : 's'} found
          </h3>

          {result.confidence !== 'high' && (
            <div className="notice error" style={{ marginBottom: 14 }}>
              Parsed with <strong>{result.confidence}</strong> confidence — check
              every figure below against the document before saving.
            </div>
          )}

          {result.trades.map((trade, index) => (
            <div
              key={index}
              style={{
                paddingBottom: 14,
                marginBottom: 14,
                borderBottom:
                  index === result.trades.length - 1 ? 'none' : '1px solid var(--grid)',
              }}
            >
              <div className="field-row">
                <label>Ticker</label>
                <input
                  value={trade.ticker}
                  onChange={(e) => edit(index, { ticker: e.target.value.toUpperCase() })}
                />
              </div>

              {trade.ticker && !known.has(trade.ticker) && (
                <div className="notice error" style={{ marginBottom: 10 }}>
                  <strong>{trade.ticker}</strong> is not in your Holdings table. This
                  row will be skipped — add the holding in Airtable first, or fix
                  the ticker.
                </div>
              )}

              <div className="field-row">
                <label>Action</label>
                <select
                  value={trade.action}
                  onChange={(e) => edit(index, { action: e.target.value as 'Buy' | 'Sell' })}
                >
                  <option value="Buy">Buy</option>
                  <option value="Sell">Sell</option>
                </select>
              </div>

              <div className="field-row">
                <label>Records as</label>
                <select
                  value={trade.state}
                  onChange={(e) =>
                    edit(index, { state: e.target.value as 'Filled' | 'Open' })
                  }
                >
                  <option value="Filled">Filled — write a Lot</option>
                  <option value="Open">Open — write an Open Order</option>
                </select>
              </div>

              <div className="field-row">
                <label>Shares</label>
                <input
                  value={trade.shares ?? ''}
                  inputMode="decimal"
                  onChange={(e) => edit(index, { shares: numeric(e.target.value) ?? 0 })}
                />
              </div>

              <div className="field-row">
                <label>{trade.state === 'Open' ? 'Limit price' : 'Price / share'}</label>
                <input
                  value={
                    (trade.state === 'Open' ? trade.limitPrice : trade.pricePerShare) ?? ''
                  }
                  inputMode="decimal"
                  onChange={(e) =>
                    edit(
                      index,
                      trade.state === 'Open'
                        ? { limitPrice: numeric(e.target.value) }
                        : { pricePerShare: numeric(e.target.value) }
                    )
                  }
                />
              </div>

              {trade.state === 'Filled' && (
                <div className="field-row">
                  <label>Fees</label>
                  <input
                    value={trade.fees ?? ''}
                    inputMode="decimal"
                    onChange={(e) => edit(index, { fees: numeric(e.target.value) })}
                  />
                </div>
              )}

              <div className="field-row">
                <label>{trade.state === 'Open' ? 'Entered' : 'Trade date'}</label>
                <input
                  type="date"
                  value={trade.tradeDate ?? ''}
                  onChange={(e) => edit(index, { tradeDate: e.target.value || null })}
                />
              </div>

              {trade.state === 'Open' && (
                <div className="field-row">
                  <label>Expires</label>
                  <input
                    type="date"
                    value={trade.expires ?? ''}
                    onChange={(e) => edit(index, { expires: e.target.value || null })}
                  />
                </div>
              )}

              <div className="field-row">
                <label>Account</label>
                <input
                  value={trade.account ?? ''}
                  onChange={(e) => edit(index, { account: e.target.value || null })}
                />
              </div>

              <div className="field-row">
                <label>Broker</label>
                <input
                  value={trade.broker ?? ''}
                  onChange={(e) => edit(index, { broker: e.target.value || null })}
                />
              </div>

              <div className="field-row">
                <label>Notes</label>
                <input
                  value={trade.notes ?? ''}
                  onChange={(e) => edit(index, { notes: e.target.value || null })}
                />
              </div>
            </div>
          ))}

          <div className="actions">
            <button type="button" className="primary" disabled={busy} onClick={commit}>
              {busy ? 'Saving…' : 'Save to Airtable'}
            </button>
            <button
              type="button"
              className="ghost"
              disabled={busy}
              onClick={() => {
                setResult(null)
                setError(null)
              }}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
