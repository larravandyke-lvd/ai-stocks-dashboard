// Server-only Airtable REST client.
//
// This is the single place the Airtable token is read. Never import this
// module from a client component — import `airtable-schema` instead, which
// carries the field IDs but no secrets and no network access.

import 'server-only'

import { TABLES, type AirtableRecord, type TableKey } from './airtable-schema'
import { HttpError } from './http-error'

const BASE_ID = process.env.AIRTABLE_BASE_ID || 'appkYRfy8yg1iGxIh'
const API_ROOT = 'https://api.airtable.com/v0'

export class AirtableError extends HttpError {
  constructor(message: string, status: number, detail = '') {
    // Pass Airtable's own 4xx through, but never a raw 401/403 — to the
    // browser that would read as "you are not signed in" when what actually
    // happened is that the server's token is wrong.
    const mapped = status >= 400 && status < 500 && status !== 401 && status !== 403
      ? status
      : 500
    super(message, mapped, detail)
  }
}

function requireToken(): string {
  const token = process.env.AIRTABLE_API_KEY
  if (!token) {
    throw new AirtableError(
      'AIRTABLE_API_KEY is not set. Add it in Vercel project settings.',
      500
    )
  }
  return token
}

export function airtableConfigured(): boolean {
  return Boolean(process.env.AIRTABLE_API_KEY && BASE_ID)
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  search?: Record<string, string>
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = requireToken()
  const url = new URL(`${API_ROOT}/${BASE_ID}${path}`)

  for (const [key, value] of Object.entries(options.search || {})) {
    url.searchParams.set(key, value)
  }

  const res = await fetch(url.toString(), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    // The app writes through this client (snapshots, trade confirmations), so
    // a cached read could hand back a position that was already superseded.
    cache: 'no-store',
  })

  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }

  if (!res.ok) {
    const err = (data as { error?: { message?: string; type?: string } } | null)?.error
    const detail = typeof err === 'string' ? err : err?.message || err?.type || ''
    throw new AirtableError(
      detail || `Airtable returned ${res.status}`,
      res.status,
      text
    )
  }

  return data as T
}

type ListResponse = { records?: AirtableRecord[]; offset?: string }

export type ListOptions = {
  sort?: { fieldId: string; direction?: 'asc' | 'desc' }[]
  /** Airtable formula. Field references inside must use NAMES, not IDs. */
  filterByFormula?: string
  maxRecords?: number
}

/**
 * Fetch records from a table, following Airtable's pagination cursor.
 *
 * `returnFieldsByFieldId=true` is set on every request and is not optional.
 * Without it Airtable keys cells by field NAME, and since this app addresses
 * everything by ID, every lookup would silently read `undefined` — the page
 * renders with blanks rather than failing, so the bug reaches production
 * looking like missing data.
 */
export async function listRecords(
  table: TableKey,
  options: ListOptions = {}
): Promise<AirtableRecord[]> {
  const records: AirtableRecord[] = []
  let offset: string | undefined

  do {
    const search: Record<string, string> = {
      pageSize: '100',
      returnFieldsByFieldId: 'true',
    }
    if (offset) search.offset = offset
    if (options.filterByFormula) search.filterByFormula = options.filterByFormula
    if (options.maxRecords) search.maxRecords = String(options.maxRecords)
    options.sort?.forEach((s, i) => {
      search[`sort[${i}][field]`] = s.fieldId
      search[`sort[${i}][direction]`] = s.direction || 'asc'
    })

    const data = await request<ListResponse>(`/${TABLES[table]}`, { search })
    records.push(...(data.records || []))
    offset = data.offset

    if (options.maxRecords && records.length >= options.maxRecords) break
  } while (offset)

  return records
}

export async function getRecord(
  table: TableKey,
  recordId: string
): Promise<AirtableRecord> {
  return request<AirtableRecord>(`/${TABLES[table]}/${recordId}`, {
    search: { returnFieldsByFieldId: 'true' },
  })
}

export type WriteOptions = {
  /**
   * Lets Airtable coerce loose input — and CREATE missing single-select
   * choices, which mutates the schema. Only turn this on for values that came
   * from a human or a parser, where a new Broker or Account is plausible.
   */
  typecast?: boolean
}

/**
 * `returnFieldsByFieldId` must travel in the BODY on POST/PATCH. As a query
 * parameter Airtable ignores it and answers with name-keyed `fields`, so a
 * write response merged into state produces keys nothing reads and the change
 * appears to do nothing until the next full refresh.
 */
export async function createRecords(
  table: TableKey,
  rows: Record<string, unknown>[],
  options: WriteOptions = {}
): Promise<AirtableRecord[]> {
  if (rows.length === 0) return []

  const created: AirtableRecord[] = []
  // Airtable caps creates at 10 records per request.
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10)
    const data = await request<{ records?: AirtableRecord[] }>(`/${TABLES[table]}`, {
      method: 'POST',
      body: {
        records: batch.map((fields) => ({ fields })),
        returnFieldsByFieldId: true,
        ...(options.typecast ? { typecast: true } : {}),
      },
    })
    created.push(...(data.records || []))
  }
  return created
}

export async function createRecord(
  table: TableKey,
  fields: Record<string, unknown>,
  options: WriteOptions = {}
): Promise<AirtableRecord> {
  const [record] = await createRecords(table, [fields], options)
  return record
}

export async function updateRecord(
  table: TableKey,
  recordId: string,
  fields: Record<string, unknown>,
  options: WriteOptions = {}
): Promise<AirtableRecord> {
  return request<AirtableRecord>(`/${TABLES[table]}/${recordId}`, {
    method: 'PATCH',
    body: {
      fields,
      returnFieldsByFieldId: true,
      ...(options.typecast ? { typecast: true } : {}),
    },
  })
}

/** Escape a value for safe interpolation into an Airtable formula string. */
export function quoteFormulaValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}
