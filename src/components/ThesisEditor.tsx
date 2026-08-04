'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

export default function ThesisEditor({
  ticker,
  initial,
}: {
  ticker: string
  initial: string
}) {
  const router = useRouter()
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A save elsewhere (or a refresh) can bring newer text down as a prop. Take
  // it — but never while an edit is open, or it would overwrite typing.
  useEffect(() => {
    if (!editing) setValue(initial)
  }, [initial, editing])

  useEffect(() => {
    if (editing) areaRef.current?.focus()
  }, [editing])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/thesis', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, thesis: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Could not save.')

      setEditing(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div>
        {error && <div className="notice error">{error}</div>}
        {value ? (
          <p className="thesis">{value}</p>
        ) : (
          <p className="thesis-empty">
            Nothing written yet — why you bought it, and what would change your
            mind.
          </p>
        )}
        <div className="actions">
          <button type="button" className="ghost" onClick={() => setEditing(true)}>
            {value ? 'Edit' : 'Write one'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {error && <div className="notice error">{error}</div>}
      <textarea
        ref={areaRef}
        className="thesis-edit"
        value={value}
        disabled={saving}
        placeholder="Why you bought it, and what would change your mind."
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          // Enter inserts a newline here, so the shortcut needs a modifier.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void save()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setValue(initial)
            setEditing(false)
            setError(null)
          }
        }}
      />
      <div className="actions">
        <button type="button" className="primary" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="ghost"
          disabled={saving}
          onClick={() => {
            setValue(initial)
            setEditing(false)
            setError(null)
          }}
        >
          Cancel
        </button>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)', alignSelf: 'center' }}>
          ⌘↵ to save · Esc to cancel
        </span>
      </div>
    </div>
  )
}
