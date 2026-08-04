import { listRecords } from '@/lib/airtable'
import { HOLDINGS, ORDERS } from '@/lib/airtable-schema'
import { errorResponse } from '@/lib/http-error'
import { mapOrder } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams
    const ticker = params.get('ticker')
    const status = params.get('status')

    const records = await listRecords('orders', {
      sort: [{ fieldId: ORDERS.orderEntered, direction: 'desc' }],
    })
    let orders = records.map(mapOrder)

    if (ticker) {
      const upper = ticker.toUpperCase()
      const holdings = await listRecords('holdings')
      const match = holdings.find(
        (record) =>
          String(record.fields[HOLDINGS.ticker] || '').toUpperCase() === upper
      )
      orders = match
        ? orders.filter((order) => order.holdingIds.includes(match.id))
        : []
    }

    if (status) {
      const wanted = status.toLowerCase()
      orders = orders.filter((order) => (order.status || '').toLowerCase() === wanted)
    }

    return Response.json({ orders })
  } catch (error) {
    return errorResponse(error)
  }
}
