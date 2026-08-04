import { Suspense } from 'react'

import LoginForm from '@/components/LoginForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in · AI Stocks Dashboard',
}

export default function LoginPage() {
  return (
    // useSearchParams needs a Suspense boundary, or the build bails out of
    // static optimisation for the whole route with a confusing error.
    <Suspense fallback={<div className="gate" />}>
      <LoginForm />
    </Suspense>
  )
}
