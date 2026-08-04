'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Renders the cached read immediately and only calls the model when there is
// nothing cached. Generating on every page load would put a multi-second model
// call in front of the whole page for text that changes at most daily.

export default function PositionRead({
  ticker,
  initial,
  initialAt,
}: {
  ticker: string
  initial: string
  initialAt: string
}) {
  const [read, setRead] = useState(initial)
  const [at, setAt] = useState(initialAt)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guards React 18 StrictMode's double-effect in development, which would
  // otherwise fire two generations — and bill two model calls — on first view.
  const requested = useRef(false)

  const generate = useCallback(
    async (force: boolean) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/position-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker, force }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Could not generate a read.')

        setRead(data.read)
        setAt(data.generatedAt)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Generation failed.')
      } finally {
        setBusy(false)
      }
    },
    [ticker]
  )

  useEffect(() => {
    if (initial || requested.current) return
    requested.current = true
    void generate(false)
  }, [initial, generate])

  if (busy && !read) {
    return (
      <div aria-busy="true" aria-label="Generating the position read">
        <div className="skeleton" style={{ width: '96%' }} />
        <div className="skeleton" style={{ width: '99%' }} />
        <div className="skeleton" style={{ width: '92%' }} />
        <div className="skeleton" style={{ width: '64%', marginBottom: 0 }} />
      </div>
    )
  }

  if (error && !read) {
    return (
      <>
        <p className="card-note">{error}</p>
        <div className="read-meta">
          <button type="button" onClick={() => generate(true)} disabled={busy}>
            Try again
          </button>
        </div>
      </>
    )
  }

  if (!read) {
    return (
      <div className="read-meta">
        <button type="button" onClick={() => generate(true)} disabled={busy}>
          Generate a read
        </button>
      </div>
    )
  }

  return (
    <>
      <p className="read-body">{read}</p>
      <div className="read-meta">
        {at && <span>Written {formatWhen(at)}</span>}
        <button type="button" onClick={() => generate(true)} disabled={busy}>
          {busy ? 'Rewriting…' : 'Refresh'}
        </button>
        {error && <span style={{ color: 'var(--down)' }}>{error}</span>}
      </div>
    </>
  )
}

function formatWhen(iso: string): string {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return 'recently'

  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
