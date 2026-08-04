import { listRecords } from '@/lib/airtable'
import { HOLDINGS, LOTS } from '@/lib/airtable-schema'
import { errorResponse } from '@/lib/http-error'
import { mapLot } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const ticker = new URL(request.url).searchParams.get('ticker')

    const records = await listRecords('lots', {
      sort: [{ fieldId: LOTS.purchaseDate, direction: 'desc' }],
    })
    let lots = records.map(mapLot)

    if (ticker) {
      // The link field holds Holdings record IDs, not the ticker string, so
      // filtering has to happen after the join rather than in the query.
      const upper = ticker.toUpperCase()
      const holdings = await listRecords('holdings')
      const match = holdings.find(
        (record) =>
          String(record.fields[HOLDINGS.ticker] || '').toUpperCase() === upper
      )
      lots = match ? lots.filter((lot) => lot.holdingIds.includes(match.id)) : []
    }

    return Response.json({ lots })
  } catch (error) {
    return errorResponse(error)
  }
}
