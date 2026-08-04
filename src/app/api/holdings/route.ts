import { errorResponse } from '@/lib/http-error'
import { loadPortfolio } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const { holdings, totals } = await loadPortfolio()
    return Response.json({ holdings, totals })
  } catch (error) {
    return errorResponse(error)
  }
}
