// Shapes raw Airtable records into the view models both pages render.
//
// DIVISION OF LABOUR
// Airtable owns share counts and cost basis — those are facts about what was
// bought, and its rollups are the source of truth. Finnhub owns the price.
// Everything derived from the two (market value, unrealized P/L) is computed
// HERE against the live quote rather than read from Airtable's formula fields,
// because those formulas depend on the `Current Price` column, which only
// changes when something writes to it. Reading them would show a P/L computed
// from whenever the base was last refreshed, which on a quiet week is stale by
// days while looking perfectly current.

import 'server-only'

import { listRecords } from './airtable'
import {
  HOLDINGS,
  LOTS,
  ORDERS,
  EARNINGS,
  STOCK_SNAPSHOT,
  readArray,
  readLinks,
  readNumber,
  readSelect,
  readText,
  type AirtableRecord,
} from './airtable-schema'
import { fetchQuotes, type Quote } from './finnhub'

export type Holding = {
  id: string
  ticker: string
  companyName: string
  theme: string | null
  status: string | null
  accounts: string[]
  positionSizeTier: string | null
  investmentThesis: string
  totalShares: number
  totalCostBasis: number
  avgCostPerShare: number | null
  lotIds: string[]
  orderIds: string[]
  // Live-derived. Null when the quote could not be fetched.
  price: number | null
  dayChangePct: number | null
  marketValue: number | null
  unrealizedPl: number | null
  unrealizedPlPct: number | null
  /** Day change in dollars across the whole position. */
  dayChangeValue: number | null
}

export type Lot = {
  id: string
  lotId: number | null
  holdingIds: string[]
  purchaseDate: string
  shares: number
  pricePerShare: number
  fees: number
  account: string | null
  broker: string | null
  status: string | null
  notes: string
  costBasis: number | null
  daysHeld: number | null
}

export type Order = {
  id: string
  orderId: number | null
  holdingIds: string[]
  orderType: string | null
  quantity: number
  limitPrice: number | null
  orderEntered: string
  expires: string
  status: string | null
  account: string | null
  broker: string | null
  notes: string
  notionalValue: number | null
  dollarsAway: number | null
  pctAway: number | null
  daysToExpiry: number | null
}

export type EarningsRecord = {
  id: string
  key: string
  holdingIds: string[]
  reportDate: string
  time: string | null
  epsEstimate: number | null
  epsActual: number | null
  revenueEstimate: number | null
  revenueActual: number | null
  surprisePct: number | null
  notes: string
}

export type SnapshotRow = {
  id: string
  key: string
  holdingIds: string[]
  date: string
  price: number | null
  marketValue: number | null
  pl: number | null
  plPct: number | null
}

function mapLot(record: AirtableRecord): Lot {
  const f = record.fields
  return {
    id: record.id,
    lotId: readNumber(f[LOTS.lotId]),
    holdingIds: readLinks(f[LOTS.ticker]),
    purchaseDate: readText(f[LOTS.purchaseDate]).slice(0, 10),
    shares: readNumber(f[LOTS.shares]) ?? 0,
    pricePerShare: readNumber(f[LOTS.pricePerShare]) ?? 0,
    fees: readNumber(f[LOTS.fees]) ?? 0,
    account: readSelect(f[LOTS.account]),
    broker: readSelect(f[LOTS.broker]),
    status: readSelect(f[LOTS.status]),
    notes: readText(f[LOTS.notes]),
    costBasis: readNumber(f[LOTS.costBasis]),
    daysHeld: readNumber(f[LOTS.daysHeld]),
  }
}

function mapOrder(record: AirtableRecord): Order {
  const f = record.fields
  return {
    id: record.id,
    orderId: readNumber(f[ORDERS.orderId]),
    holdingIds: readLinks(f[ORDERS.ticker]),
    orderType: readSelect(f[ORDERS.orderType]),
    quantity: readNumber(f[ORDERS.quantity]) ?? 0,
    limitPrice: readNumber(f[ORDERS.limitPrice]),
    orderEntered: readText(f[ORDERS.orderEntered]).slice(0, 10),
    expires: readText(f[ORDERS.expires]).slice(0, 10),
    status: readSelect(f[ORDERS.status]),
    account: readSelect(f[ORDERS.account]),
    broker: readSelect(f[ORDERS.broker]),
    notes: readText(f[ORDERS.notes]),
    notionalValue: readNumber(f[ORDERS.notionalValue]),
    dollarsAway: readNumber(f[ORDERS.dollarsAway]),
    pctAway: readNumber(f[ORDERS.pctAway]),
    daysToExpiry: readNumber(f[ORDERS.daysToExpiry]),
  }
}

function mapEarnings(record: AirtableRecord): EarningsRecord {
  const f = record.fields
  return {
    id: record.id,
    key: readText(f[EARNINGS.key]),
    holdingIds: readLinks(f[EARNINGS.ticker]),
    reportDate: readText(f[EARNINGS.reportDate]).slice(0, 10),
    time: readSelect(f[EARNINGS.time]),
    epsEstimate: readNumber(f[EARNINGS.epsEstimate]),
    epsActual: readNumber(f[EARNINGS.epsActual]),
    revenueEstimate: readNumber(f[EARNINGS.revenueEstimate]),
    revenueActual: readNumber(f[EARNINGS.revenueActual]),
    surprisePct: readNumber(f[EARNINGS.surprisePct]),
    notes: readText(f[EARNINGS.notes]),
  }
}

function mapSnapshot(record: AirtableRecord): SnapshotRow {
  const f = record.fields
  return {
    id: record.id,
    key: readText(f[STOCK_SNAPSHOT.key]),
    holdingIds: readLinks(f[STOCK_SNAPSHOT.ticker]),
    date: readText(f[STOCK_SNAPSHOT.date]).slice(0, 10),
    price: readNumber(f[STOCK_SNAPSHOT.price]),
    marketValue: readNumber(f[STOCK_SNAPSHOT.marketValue]),
    pl: readNumber(f[STOCK_SNAPSHOT.pl]),
    plPct: readNumber(f[STOCK_SNAPSHOT.plPct]),
  }
}

function mapHolding(record: AirtableRecord, quote: Quote | undefined): Holding {
  const f = record.fields
  const totalShares = readNumber(f[HOLDINGS.totalShares]) ?? 0
  const totalCostBasis = readNumber(f[HOLDINGS.totalCostBasis]) ?? 0

  // Fall back to the price stored in Airtable when the live quote is missing,
  // so a Finnhub outage degrades to "last known" rather than to blanks.
  const price = quote?.price ?? readNumber(f[HOLDINGS.currentPrice])
  const dayChangePct = quote?.changePct ?? readNumber(f[HOLDINGS.dayChangePct])

  const marketValue = price === null ? null : totalShares * price
  const unrealizedPl = marketValue === null ? null : marketValue - totalCostBasis
  const unrealizedPlPct =
    unrealizedPl === null || totalCostBasis === 0
      ? null
      : unrealizedPl / totalCostBasis
  const dayChangeValue =
    quote?.change === null || quote?.change === undefined
      ? null
      : quote.change * totalShares

  return {
    id: record.id,
    ticker: readText(f[HOLDINGS.ticker]).toUpperCase(),
    companyName: readText(f[HOLDINGS.companyName]),
    theme: readSelect(f[HOLDINGS.theme]),
    status: readSelect(f[HOLDINGS.status]),
    accounts: readArray(f[HOLDINGS.account]),
    positionSizeTier: readSelect(f[HOLDINGS.positionSizeTier]),
    investmentThesis: readText(f[HOLDINGS.investmentThesis]),
    totalShares,
    totalCostBasis,
    avgCostPerShare:
      readNumber(f[HOLDINGS.avgCostPerShare]) ??
      (totalShares > 0 ? totalCostBasis / totalShares : null),
    lotIds: readLinks(f[HOLDINGS.lots]),
    orderIds: readLinks(f[HOLDINGS.openOrders]),
    price,
    dayChangePct,
    marketValue,
    unrealizedPl,
    unrealizedPlPct,
    dayChangeValue,
  }
}

export type PortfolioTotals = {
  marketValue: number
  costBasis: number
  unrealizedPl: number
  unrealizedPlPct: number | null
  dayChangeValue: number
  dayChangePct: number | null
}

export function totalsFor(holdings: Holding[]): PortfolioTotals {
  let marketValue = 0
  let costBasis = 0
  let dayChangeValue = 0

  for (const holding of holdings) {
    costBasis += holding.totalCostBasis
    if (holding.marketValue !== null) marketValue += holding.marketValue
    if (holding.dayChangeValue !== null) dayChangeValue += holding.dayChangeValue
  }

  const unrealizedPl = marketValue - costBasis
  const openingValue = marketValue - dayChangeValue

  return {
    marketValue,
    costBasis,
    unrealizedPl,
    unrealizedPlPct: costBasis === 0 ? null : unrealizedPl / costBasis,
    dayChangeValue,
    dayChangePct: openingValue === 0 ? null : dayChangeValue / openingValue,
  }
}

/** Group holdings by an arbitrary key for the allocation breakdowns. */
export function allocationBy(
  holdings: Holding[],
  pick: (holding: Holding) => string | null
): { label: string; value: number; share: number }[] {
  const buckets = new Map<string, number>()
  let total = 0

  for (const holding of holdings) {
    if (holding.marketValue === null) continue
    const label = pick(holding) || 'Unclassified'
    buckets.set(label, (buckets.get(label) || 0) + holding.marketValue)
    total += holding.marketValue
  }

  return [...buckets.entries()]
    .map(([label, value]) => ({
      label,
      value,
      share: total === 0 ? 0 : value / total,
    }))
    .sort((a, b) => b.value - a.value)
}

export type PortfolioData = {
  holdings: Holding[]
  lots: Lot[]
  orders: Order[]
  quotes: Record<string, Quote>
  totals: PortfolioTotals
}

/**
 * One round trip for the whole dashboard. Holdings, lots and orders come from
 * Airtable in parallel; quotes are then fetched for the tickers that exist.
 */
export async function loadPortfolio(): Promise<PortfolioData> {
  const [holdingRecords, lotRecords, orderRecords] = await Promise.all([
    listRecords('holdings', {
      sort: [{ fieldId: HOLDINGS.ticker, direction: 'asc' }],
    }),
    listRecords('lots', {
      sort: [{ fieldId: LOTS.purchaseDate, direction: 'desc' }],
    }),
    listRecords('orders', {
      sort: [{ fieldId: ORDERS.orderEntered, direction: 'desc' }],
    }),
  ])

  const tickers = holdingRecords
    .map((record) => readText(record.fields[HOLDINGS.ticker]).toUpperCase())
    .filter(Boolean)

  const quotes = await fetchQuotes(tickers)

  const holdings = holdingRecords.map((record) =>
    mapHolding(record, quotes[readText(record.fields[HOLDINGS.ticker]).toUpperCase()])
  )

  return {
    holdings,
    lots: lotRecords.map(mapLot),
    orders: orderRecords.map(mapOrder),
    quotes,
    totals: totalsFor(holdings),
  }
}

export async function loadEarnings(): Promise<EarningsRecord[]> {
  const records = await listRecords('earnings', {
    sort: [{ fieldId: EARNINGS.reportDate, direction: 'desc' }],
  })
  return records.map(mapEarnings)
}

export async function loadSnapshots(): Promise<SnapshotRow[]> {
  const records = await listRecords('stockSnapshot', {
    sort: [{ fieldId: STOCK_SNAPSHOT.date, direction: 'asc' }],
  })
  return records.map(mapSnapshot)
}

export { mapLot, mapOrder, mapEarnings, mapSnapshot, mapHolding }
