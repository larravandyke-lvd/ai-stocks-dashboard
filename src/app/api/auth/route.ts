// Sign in (POST) and sign out (DELETE).
//
// Excluded from the middleware matcher — it has to stay reachable to let you
// back in. It does its own checking.

import { NextResponse } from 'next/server'

import { AUTH_COOKIE, AUTH_MAX_AGE, authToken, safeEqual } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const expected = process.env.DASHBOARD_PASSWORD

  // No hardcoded fallback, deliberately. A `process.env.X || '<literal>'`
  // pattern means an unset variable silently accepts a password committed to
  // the repository — which is exactly how a gate ends up not being one.
  if (!expected) {
    console.error('[auth] DASHBOARD_PASSWORD is not set; refusing all sign-ins.')
    return NextResponse.json(
      { error: 'The dashboard password is not configured.' },
      { status: 503 }
    )
  }

  let password: unknown
  try {
    ;({ password } = (await request.json()) as { password?: unknown })
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 })
  }

  if (typeof password !== 'string' || !safeEqual(password, expected)) {
    // Deliberately vague, and identical for a wrong password and a missing
    // one — there is nothing useful to tell an attacker here.
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 })
  }

  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: AUTH_COOKIE,
    value: await authToken(expected),
    httpOnly: true, // not readable from JavaScript, unlike sessionStorage
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // http://localhost in dev
    path: '/',
    maxAge: AUTH_MAX_AGE,
  })
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set({
    name: AUTH_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return response
}
