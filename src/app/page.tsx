import Link from 'next/link'

import { AllocationBars, DonutChart, PLBars } from '@/components/charts'
import SignOut from '@/components/SignOut'
import TradeConfirmationUpload from '@/components/TradeConfirmationUpload'
import { airtableConfigured } from '@/lib/airtable'
import { finnhubConfigured } from '@/lib/finnhub'
import {
  money,
  percent,
  shares as fmtShares,
  signedMoney,
  signedPercent,
  toneFor,
} from '@/lib/format'
import { allocationBy, loadPortfolio, type Holding } from '@/lib/portfolio'
import { ensureTodaySnapshots } from '@/lib/snapshot'

// Every load hits Airtable and Finnhub for live values, and writes the day's
// snapshot. Nothing here may be statically rendered or cached.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function OverviewPage() {
  if (!airtableConfigured()) {
    return (
      <ConfigNotice
        missing={[
          ...(process.env.AIRTABLE_API_KEY ? [] : ['AIRTABLE_API_KEY']),
          ...(finnhubConfigured() ? [] : ['FINNHUB_API_KEY']),
        ]}
      />
    )
  }

  let data
  try {
    data = await loadPortfolio()
  } catch (error) {
    return <LoadFailure error={error} />
  }

  const { holdings, lots, orders, totals } = data

  // Snapshot-on-load. Deliberately awaited rather than fired and forgotten:
  // on serverless the instance can be frozen the moment the response is sent,
  // which would drop an un-awaited write on the floor.
  const snapshot = await ensureTodaySnapshots(holdings)

  const active = holdings.filter(
    (holding) => (holding.status || '').toLowerCase() !== 'closed'
  )

  const movers = [...active]
    .filter((holding) => holding.dayChangePct !== null)
    .sort(
      (a, b) => Math.abs(b.dayChangePct ?? 0) - Math.abs(a.dayChangePct ?? 0)
    )
    .slice(0, 5)

  const byValue = [...active].sort(
    (a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)
  )

  const openOrders = orders.filter(
    (order) => (order.status || 'Open').toLowerCase() === 'open'
  )

  // Allocation by position, used by both the donut and the concentration check.
  const byPosition = active
    .filter((holding) => holding.marketValue !== null && holding.marketValue > 0)
    .map((holding) => ({
      label: holding.ticker,
      value: holding.marketValue as number,
      share:
        totals.marketValue > 0
          ? (holding.marketValue as number) / totals.marketValue
          : 0,
      href: `/stock/${holding.ticker}`,
    }))
    .sort((a, b) => b.value - a.value)

  // 25% is the "worth naming" line, 30% the "this dominates the portfolio" one.
  const CONCENTRATION_WARN = 0.25
  const CONCENTRATION_SEVERE = 0.3
  const concentrated = byPosition.filter((row) => row.share >= CONCENTRATION_WARN)
  const severe = concentrated.some((row) => row.share >= CONCENTRATION_SEVERE)

  const plRows = active
    .filter((holding) => holding.unrealizedPlPct !== null)
    .map((holding) => ({
      label: holding.ticker,
      value: holding.unrealizedPlPct as number,
      href: `/stock/${holding.ticker}`,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <>
      <header className="masthead">
        <h1>AI Stocks</h1>
        <a
          href="https://portals-gateway.vercel.app"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: '12px', fontWeight: 700, color: '#4c7fd1', display: 'flex', alignItems: 'center', gap: '6px', fontFamily: 'Georgia,serif' }}
        >
          <svg width="18" height="18" viewBox="0 0 64 64"><defs><linearGradient id="pmg1" x1="4" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#f6e3b4"/><stop offset=".5" stopColor="#c9a24b"/><stop offset="1" stopColor="#7a5a35"/></linearGradient></defs><circle cx="32" cy="32" r="30" fill="url(#pmg1)"/><circle cx="32" cy="32" r="26" fill="none" stroke="#1b1207" strokeOpacity=".28" strokeWidth="1.5"/><text x="32" y="43" fontFamily="Georgia,serif" fontStyle="italic" fontWeight="700" fontSize="30" fill="#1b1207" textAnchor="middle">V</text></svg>
          Portal Menu
        </a>
        <span className="meta">
          {active.length} positions · {lots.length} lots · {openOrders.length} open
          orders ·{' '}
          {snapshot.written.length > 0
            ? `${snapshot.written.length} snapshot${snapshot.written.length === 1 ? '' : 's'} written`
            : `snapshots current to ${snapshot.date}`}
          {' · '}
          <SignOut />
        </span>
      </header>

      {concentrated.length > 0 && (
        <div className={`callout${severe ? ' severe' : ''}`} role="status">
          <svg
            className="callout-icon"
            viewBox="0 0 20 20"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M10 2.5 18.5 17.5H1.5L10 2.5Z"
              stroke={severe ? 'var(--critical)' : 'var(--warning)'}
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path
              d="M10 8v4"
              stroke={severe ? 'var(--critical)' : 'var(--warning)'}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <circle
              cx="10"
              cy="14.8"
              r="0.95"
              fill={severe ? 'var(--critical)' : 'var(--warning)'}
            />
          </svg>
          <div>
            <h3>
              {concentrated.length === 1
                ? `${concentrated[0].label} is ${(concentrated[0].share * 100).toFixed(1)}% of the portfolio`
                : `${concentrated.length} positions exceed ${CONCENTRATION_WARN * 100}% of the portfolio`}
            </h3>
            <p>
              {concentrated.map((row, index) => (
                <span key={row.label}>
                  {index > 0 && ', '}
                  <Link href={row.href}>{row.label}</Link> at{' '}
                  {(row.share * 100).toFixed(1)}% ({money(row.value)})
                </span>
              ))}
              . A single position this size drives the portfolio&rsquo;s return
              more than every other holding combined.
            </p>
          </div>
        </div>
      )}

      {snapshot.error && (
        <div className="notice error">
          <strong>Snapshot not written.</strong> {snapshot.error} Prices and P/L
          below are still live — only today&rsquo;s history row is missing.
        </div>
      )}

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="label">Market value</div>
          <div className="value">{money(totals.marketValue)}</div>
          <div className={`sub ${toneFor(totals.dayChangeValue)}`}>
            {signedMoney(totals.dayChangeValue)} today
          </div>
        </div>
        <div className="stat">
          <div className="label">Cost basis</div>
          <div className="value">{money(totals.costBasis)}</div>
          <div className="sub">
            {active.length} position{active.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="stat">
          <div className="label">Unrealized P/L</div>
          <div className={`value ${toneFor(totals.unrealizedPl)}`}>
            {signedMoney(totals.unrealizedPl)}
          </div>
          <div className={`sub ${toneFor(totals.unrealizedPlPct)}`}>
            {signedPercent(totals.unrealizedPlPct)}
          </div>
        </div>
        <div className="stat">
          <div className="label">Today</div>
          <div className={`value ${toneFor(totals.dayChangePct)}`}>
            {signedPercent(totals.dayChangePct)}
          </div>
          <div className={`sub ${toneFor(totals.dayChangeValue)}`}>
            {signedMoney(totals.dayChangeValue)}
          </div>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Allocation by position</h2>
          <DonutChart rows={byPosition} total={totals.marketValue} />
        </div>

        <div className="card">
          <h2>Unrealized P/L % by ticker</h2>
          <PLBars rows={plRows} />
        </div>
      </div>

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>Allocation by theme</h2>
          <AllocationBars
            rows={allocationBy(active, (holding) => holding.theme)}
            formatValue={money}
          />
        </div>

        <div className="card">
          <h2>Allocation by position size tier</h2>
          <AllocationBars
            rows={allocationBy(active, (holding) => holding.positionSizeTier)}
            formatValue={money}
          />
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Day movers</h2>
        {movers.length === 0 ? (
          <p className="card-note">No live quotes available right now.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Position</th>
                  <th className="num">Price</th>
                  <th className="num">Day %</th>
                  <th className="num">Day $</th>
                </tr>
              </thead>
              <tbody>
                {movers.map((holding) => (
                  <tr key={holding.id} className="row-link">
                    <td className="primary">
                      <Link href={`/stock/${holding.ticker}`}>
                        <TickerCell holding={holding} />
                      </Link>
                    </td>
                    <td className="num">{money(holding.price)}</td>
                    <td className={`num ${toneFor(holding.dayChangePct)}`}>
                      {signedPercent(holding.dayChangePct)}
                    </td>
                    <td className={`num ${toneFor(holding.dayChangeValue)}`}>
                      {signedMoney(holding.dayChangeValue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Holdings</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Position</th>
                <th>Theme</th>
                <th className="num">Shares</th>
                <th className="num">Avg cost</th>
                <th className="num">Price</th>
                <th className="num">Market value</th>
                <th className="num">Unrealized P/L</th>
                <th className="num">P/L %</th>
              </tr>
            </thead>
            <tbody>
              {byValue.map((holding) => (
                <tr key={holding.id} className="row-link">
                  <td className="primary">
                    <Link href={`/stock/${holding.ticker}`}>
                      <TickerCell holding={holding} />
                    </Link>
                  </td>
                  <td>
                    {holding.theme ? (
                      <span className="badge">{holding.theme}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="num">{fmtShares(holding.totalShares)}</td>
                  <td className="num">{money(holding.avgCostPerShare)}</td>
                  <td className="num">{money(holding.price)}</td>
                  <td className="num">{money(holding.marketValue)}</td>
                  <td className={`num ${toneFor(holding.unrealizedPl)}`}>
                    {signedMoney(holding.unrealizedPl)}
                  </td>
                  <td className={`num ${toneFor(holding.unrealizedPlPct)}`}>
                    {signedPercent(holding.unrealizedPlPct)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="primary">Total</td>
                <td />
                <td />
                <td />
                <td />
                <td className="num primary">{money(totals.marketValue)}</td>
                <td className={`num ${toneFor(totals.unrealizedPl)}`}>
                  {signedMoney(totals.unrealizedPl)}
                </td>
                <td className={`num ${toneFor(totals.unrealizedPlPct)}`}>
                  {signedPercent(totals.unrealizedPlPct)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {openOrders.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>Open orders</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Type</th>
                  <th className="num">Qty</th>
                  <th className="num">Limit</th>
                  <th className="num">% away</th>
                  <th>Expires</th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((order) => {
                  const holding = holdings.find((h) =>
                    order.holdingIds.includes(h.id)
                  )
                  return (
                    <tr key={order.id}>
                      <td className="primary">
                        {holding ? (
                          <Link href={`/stock/${holding.ticker}`}>
                            {holding.ticker}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{order.orderType || '—'}</td>
                      <td className="num">{fmtShares(order.quantity)}</td>
                      <td className="num">{money(order.limitPrice)}</td>
                      <td className="num">{percent(order.pctAway)}</td>
                      <td>{order.expires || '—'}</td>
                      <td>{order.account || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Log a trade confirmation</h2>
        <TradeConfirmationUpload
          holdings={active.map((holding) => ({
            id: holding.id,
            ticker: holding.ticker,
          }))}
        />
      </div>
    </>
  )
}

function TickerCell({ holding }: { holding: Holding }) {
  return (
    <span className="ticker-cell">
      <span className="sym">{holding.ticker}</span>
      <span className="name">{holding.companyName}</span>
    </span>
  )
}

function ConfigNotice({ missing }: { missing: string[] }) {
  return (
    <>
      <header className="masthead">
        <h1>AI Stocks</h1>
      </header>
      <div className="card">
        <h2>Not configured yet</h2>
        <p className="card-note">
          {missing.length > 0 ? (
            <>
              Missing environment{' '}
              {missing.length === 1 ? 'variable' : 'variables'}:{' '}
              <strong>{missing.join(', ')}</strong>. Add{' '}
              {missing.length === 1 ? 'it' : 'them'} in the Vercel project
              settings, then redeploy.
            </>
          ) : (
            'Add the required environment variables in Vercel, then redeploy.'
          )}
        </p>
      </div>
    </>
  )
}

function LoadFailure({ error }: { error: unknown }) {
  const message =
    error instanceof Error ? error.message : 'Could not reach Airtable.'
  const looksLikePermissions = /permission|not found|invalid/i.test(message)

  return (
    <>
      <header className="masthead">
        <h1>AI Stocks</h1>
      </header>
      <div className="card">
        <h2>Could not load the portfolio</h2>
        <p className="card-note">{message}</p>
        {looksLikePermissions && (
          <p className="card-note" style={{ marginTop: 10 }}>
            This usually means the Airtable personal access token is not scoped
            to this base. In Airtable, open the token, add{' '}
            <strong>appkYRfy8yg1iGxIh</strong> under Access, and confirm it has{' '}
            <strong>data.records:read</strong>,{' '}
            <strong>data.records:write</strong> and{' '}
            <strong>schema.bases:read</strong>.
          </p>
        )}
      </div>
    </>
  )
}
