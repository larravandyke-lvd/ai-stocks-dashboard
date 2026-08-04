'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function SignOut() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      className="signout"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await fetch('/api/auth', { method: 'DELETE' })
          // replace(), not push() — Back should not return to a page whose
          // data the visitor is no longer entitled to see.
          router.replace('/login')
          router.refresh()
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
