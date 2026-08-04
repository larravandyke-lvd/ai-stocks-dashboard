'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

export default function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()

  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const unconfigured = params.get('reason') === 'unconfigured'

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!password.trim() || busy) return

    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error || 'Incorrect password.')
        setPassword('')
        return
      }

      // Only accept a same-origin relative path — a `next` of
      // `https://elsewhere.example` would otherwise make this an open redirect.
      const next = params.get('next')
      const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/'

      router.replace(target)
      router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="gate-mark" aria-hidden="true">
          ◆
        </div>
        <h1>AI Stocks</h1>
        <p className="gate-sub">Private portfolio dashboard</p>

        {unconfigured ? (
          <p className="gate-error" role="alert">
            No dashboard password is configured on the server. Set
            DASHBOARD_PASSWORD in the Vercel project settings.
          </p>
        ) : (
          <>
            <label className="gate-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="gate-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              disabled={busy}
              onChange={(event) => {
                setPassword(event.target.value)
                setError(null)
              }}
            />
            {error && (
              <p className="gate-error" role="alert">
                {error}
              </p>
            )}
            <button className="gate-button" type="submit" disabled={busy}>
              {busy ? 'Checking…' : 'Sign in'}
            </button>
          </>
        )}
      </form>
    </div>
  )
}
