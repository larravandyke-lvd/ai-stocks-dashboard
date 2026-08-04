// Table and field IDs for the AI Stocks base (appkYRfy8yg1iGxIh).
//
// This module is deliberately free of secrets and network access so it can be
// imported from client components. The token lives only in `airtable.ts`.
//
// Everything addresses Airtable by ID rather than by name. Names in this base
// are not safe to depend on — "Avg Cost / Share (Formula" has an unbalanced
// paren and "Unrealized P/L % " has a trailing space. IDs are stable across
// renames; names are one careless edit away from breaking every read.

export const TABLES = {
  holdings: 'tblE0rySW4n5ja4s6',
  lots: 'tblKqPfrh4KlfgUFo',
  orders: 'tbl2sxJclQVuszLj4',
  portfolioSummary: 'tblRMRE0aDznHknrO',
  portfolioSnapshot: 'tblI1NP8j3OkYpgJE',
  earnings: 'tblrUHASKIvimZN5g',
  stockSnapshot: 'tbl3T2dcRgsb3WLTu',
} as const

export type TableKey = keyof typeof TABLES

export const HOLDINGS = {
  ticker: 'fldynaJuId0bJZGhP',
  companyName: 'fldQbBYsMq1CKpQG9',
  theme: 'fld7FFqSweblGH3W0',
  status: 'fldGyYgpFNATdBANy',
  refresh: 'fldUrb3WNL32RE9u8',
  currentPrice: 'fldp2thG9LrsayixG',
  dayChangePct: 'fld16RvjQoTrn3wwi',
  lastUpdated: 'fldR64orRt3ArX8bf',
  lots: 'fldOfU5xyuw9hFunh',
  openOrders: 'fldFdY1bSZT5OrAzC',
  totalShares: 'fldaWeENrPbOkrS8t',
  totalCostBasis: 'fldoCyUsMIOWE0L9u',
  marketValue: 'fldi8qnsqZju1YNE7',
  unrealizedPl: 'fldsIrWEPyEPOFqLo',
  account: 'fldRgWvc3YBN3jaFx',
  positionSizeTier: 'fldRyRvm1iUrqMD7K',
  avgCostPerShare: 'fldJQb17j5jbHNMzZ',
  unrealizedPlPct: 'fldZGnbdvGEjeqYV1',
  portfolioSummary: 'fldQseY0whDWjOuaK',
  investmentThesis: 'fldKWQ0mRqOerWDpB',
} as const

export const LOTS = {
  lotId: 'fldkzvrexcXpCEsTT',
  ticker: 'fldmOAjzMmUuC9Vre',
  purchaseDate: 'fldfBUAFRkkxTWlJJ',
  shares: 'fldkle1uXotGNEXvz',
  pricePerShare: 'fldTJCQ77oyhV4xIt',
  fees: 'fldXwY5igenQBc0ls',
  account: 'fldmU8hHbEt1hQQoM',
  notes: 'fldvoWSaeFwoKLs6u',
  status: 'fldXXLKUJcWvA2qFM',
  broker: 'fld5nPXsD1b77BjjS',
  // Computed in Airtable. Reading these rather than recomputing keeps the
  // dashboard and the base from ever disagreeing about a lot's P/L.
  costBasis: 'fldmPbcX50c4JzMrw',
  currentPrice: 'fldZILAX9CQ62KmHI',
  lotMarketValue: 'fldpnXHEXM9N8uDtW',
  lotPl: 'fld1sKIUHh24OVxcp',
  lotPlPct: 'fldP9wRaaXRApeOip',
  daysHeld: 'fld8Z1Vl9IOirHbUu',
} as const

export const ORDERS = {
  orderId: 'fldTBzYlIqbf4rU7m',
  ticker: 'fld3EN6JOzBJrQInL',
  orderType: 'fldGSXoJmTIUJ7gLg',
  quantity: 'fldq8S0GzKVRmtpxA',
  limitPrice: 'fldzQq78lM3lhfENX',
  orderEntered: 'fldIa0hn5ZfpT2T3B',
  expires: 'fldInMMna1o8VlET4',
  status: 'fldcbxIW43LuserQi',
  account: 'fldFelqPN6zOoLAEY',
  notes: 'fldmb7pQsmrUOtf07',
  broker: 'fldx1EcHWZDzrqhLI',
  // Computed in Airtable.
  currentPrice: 'fldaBnrBnGh9dvsA9',
  notionalValue: 'fldSy8OpgNf0X58Cz',
  dollarsAway: 'fldifWYaf88JHH5Ey',
  pctAway: 'fld0BCP0GNQZAH9e0',
  statusNote: 'fld0iSnS60okCSmZy',
  daysToExpiry: 'fldazfCGMjCtzDryg',
} as const

export const EARNINGS = {
  key: 'fldU3ajz4OY3xNszU',
  ticker: 'fldi3JmIoCY2mdmKy',
  reportDate: 'fldIRpVOeiHdG6X06',
  time: 'fld07jmDIz5s6dY4s',
  epsEstimate: 'fldLnHW76K4aaCvIV',
  epsActual: 'fldgI2mxbEJuwO6c0',
  revenueEstimate: 'fldnzHfWQMpZoAQ70',
  revenueActual: 'fldmR3lFeCtAR3dfl',
  surprisePct: 'fldis4sXYhk9cAClG',
  notes: 'fldDAb7vgXnpy4CFx',
} as const

export const STOCK_SNAPSHOT = {
  key: 'fldOd9nKjXurx5RA9',
  ticker: 'fldIg8SEaq4q0qrQN',
  date: 'fldzdxlb02OShqScZ',
  price: 'fldZsSBzgFD9nxsRp',
  marketValue: 'fldteyjtewW0U9IaS',
  pl: 'fldk6kf6C79gEVBvz',
  plPct: 'fldhT0FrWkLLrkb7x',
} as const

/** A single record as Airtable returns it with `returnFieldsByFieldId=true`. */
export type AirtableRecord = {
  id: string
  createdTime?: string
  fields: Record<string, unknown>
}

/**
 * Single-select and linked-record cells come back shaped differently depending
 * on which Airtable API answered (REST returns a bare string for a select; the
 * MCP layer returns `{id, name, color}`). These readers accept either.
 */
export function readSelect(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name
    return typeof name === 'string' ? name : null
  }
  return null
}

export function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readText(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  return ''
}

/**
 * Rollups and lookups always arrive as arrays, even when they hold one value.
 * `Account` on Holdings is a rollup over the lots, so a position bought in two
 * accounts legitimately yields two entries.
 */
export function readArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => readSelect(entry) ?? (typeof entry === 'string' ? entry : null))
    .filter((entry): entry is string => Boolean(entry))
}

/** Linked-record cells hold record IDs. */
export function readLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry
      if (entry && typeof entry === 'object' && 'id' in entry) {
        const id = (entry as { id?: unknown }).id
        return typeof id === 'string' ? id : null
      }
      return null
    })
    .filter((entry): entry is string => Boolean(entry))
}
