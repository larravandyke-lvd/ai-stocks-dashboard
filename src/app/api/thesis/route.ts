// Inline edit for the Investment Thesis field on Holdings.

import { listRecords, updateRecord } from '@/lib/airtable'
import { HOLDINGS, readText } from '@/lib/airtable-schema'
import { errorResponse, HttpError } from '@/lib/http-error'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      ticker?: string
      thesis?: string
    }

    const ticker = (body.ticker || '').toUpperCase().trim()
    if (!ticker) throw new HttpError('No ticker was supplied.', 400)

    // `thesis` is intentionally allowed to be empty — clearing the field is a
    // legitimate edit, and rejecting it would strand a thesis you want gone.
    if (typeof body.thesis !== 'string') {
      throw new HttpError('No thesis text was supplied.', 400)
    }
    if (body.thesis.length > 100_000) {
      throw new HttpError('That thesis is too long to store.', 413)
    }

    const holdings = await listRecords('holdings')
    const match = holdings.find(
      (record) => readText(record.fields[HOLDINGS.ticker]).toUpperCase() === ticker
    )
    if (!match) throw new HttpError(`No holding found for ${ticker}.`, 404)

    await updateRecord('holdings', match.id, {
      [HOLDINGS.investmentThesis]: body.thesis,
    })

    return Response.json({ ok: true, ticker })
  } catch (error) {
    return errorResponse(error)
  }
}
