// Server-side gate for the whole dashboard.
//
// This runs before every page and API route, so an unauthenticated request
// never reaches the code that reads Airtable. That is the point: a gate that
// only hides the UI still serves the entire portfolio to anyone who requests
// `/api/holdings` directly, which is what a client-side `sessionStorage` check
// would do here.
//
// Fails CLOSED. If DASHBOARD_PASSWORD is unset, nothing is accessible rather
// than everything — the opposite default would publish the portfolio the first
// time an environment variable failed to propagate.

import { NextResponse, type NextRequest } from 'next/server'

import { AUTH_COOKIE, authToken, safeEqual } from '@/lib/auth'

export async function middleware(request: NextRequest) {
  const expected = process.env.DASHBOARD_PASSWORD
  const isApi = request.nextUrl.pathname.startsWith('/api/')

  if (!expected) {
    console.error(
      '[auth] DASHBOARD_PASSWORD is not set; refusing every request. ' +
        'Set it in the Vercel project environment variables.'
    )
    return isApi
      ? NextResponse.json(
          { error: 'The dashboard password is not configured.' },
          { status: 503 }
        )
      : redirectToLogin(request, 'unconfigured')
  }

  const cookie = request.cookies.get(AUTH_COOKIE)?.value
  if (cookie && safeEqual(cookie, await authToken(expected))) {
    return NextResponse.next()
  }

  // An expired session inside a fetch should read as "sign in again", not as a
  // login page arriving where JSON was expected.
  if (isApi) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  return redirectToLogin(request, null)
}

function redirectToLogin(request: NextRequest, reason: string | null) {
  const url = new URL('/login', request.url)
  // Send the visitor back where they were aiming once they are through.
  const target = request.nextUrl.pathname + request.nextUrl.search
  if (target && target !== '/') url.searchParams.set('next', target)
  if (reason) url.searchParams.set('reason', reason)
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except the login page, the endpoint that signs you in, and
  // static assets — those must stay reachable or there is no way back in.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|favicon.svg|login|api/auth).*)',
  ],
}
