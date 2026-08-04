import Link from 'next/link'
import { notFound } from 'next/navigation'

import { LineChart, RecommendationBar, type LotMarker, type Series } from '@/components/charts'
import { airtableConfigured } from '@/lib/airtable'
import { daysBetween, formatDate, marketDate } from '@/lib/dates'
import {
  fetchNews,
  fetchProfile,
  fetchRecommendations,
  tryFetch,
} from '@/lib/finnhub'
import {
  money,
  moneyCompact,
  percent,
  shares as fmtShares,
  signedMoney,
  signedPercent,
  toneFor,
} from '@/lib/format'
import { BENCHMARKS, fetchPriceSeriesMany, toPercentChange } from '@/lib/history'
import { loadEarnings, loadPortfolio, loadSnapshots } from '@/lib/portfolio'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function StockPage({
  params,
}: {
  params: { ticker: string }
}) {
  const ticker = decodeURIComponent(params.ticker).toUpperCase()

  if (!airtableConfigured()) notFound()

  const { holdings, lots, orders } = await loadPortfolio()
  const holding = holdings.find((entry) => entry.ticker === ticker)
  if (!holding) notFound()

  const myLots = lots
    .filter((lot) => lot.holdingIds.includes(holding.id))
    .sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate))

  const myOrders = orders.filter((order) => order.holdingIds.includes(holding.id))

  const firstPurchase = myLots.find((lot) => lot.purchaseDate)?.purchaseDate || null

  // Everything below is best-effort: a failed sidebar must not blank the page.
  const [series, snapshots, earnings, profile, recommendations, news] =
    await Promise.all([
      fetchPriceSeriesMany([ticker, ...BENCHMARKS], {
        fromIso: firstPurchase || undefined,
        range: firstPurchase ? undefined : '1y',
      }),
      tryFetch(() => loadSnapshots(), [], 'Snapshot load'),
      tryFetch(() => loadEarnings(), [], 'Earnings load'),
      tryFetch(() => fetchProfile(ticker), null, `Profile ${ticker}`),
      tryFetch(() => fetchRecommendations(ticker), [], `Recommendations ${ticker}`),
      tryFetch(() => fetchNews(ticker), [], `News ${ticker}`),
    ])

  const priceSeries = series[ticker]

  // Lot markers sit on the price line. A lot bought before the chart's first
  // bar is clamped forward so the marker still lands on the plot.
  const firstBar = priceSeries?.points[0]?.date
  const markers: LotMarker[] = priceSeries
    ? myLots
        .filter((lot) => lot.purchaseDate && lot.pricePerShare > 0)
        .map((lot) => ({
          date:
            firstBar && lot.purchaseDate < firstBar ? firstBar : lot.purchaseDate,
          price: lot.pricePerShare,
          label: `${fmtShares(lot.shares)}`,
        }))
    : []

  // Benchmarks are rebased to percent change from the first shared bar, so one
  // axis carries all three. A second y-axis would be the classic way to plot a
  // $275 stock against a $600 index — and the classic way to mislead.
  const benchmarkSeries: Series[] = []
  if (priceSeries) {
    benchmarkSeries.push({
      name: ticker,
      colorVar: '--series-1',
      points: toPercentChange(priceSeries.points),
    })
    BENCHMARKS.forEach((symbol, index) => {
      const bench = series[symbol]
      if (bench) {
        benchmarkSeries.push({
          name: symbol,
          colorVar: index === 0 ? '--series-2' : '--series-3',
          points: toPercentChange(bench.points),
        })
      }
    })
  }

  const mySnapshots = snapshots
    .filter((row) => row.holdingIds.includes(holding.id))
    .filter((row) => row.date)

  const plSeries: Series[] = [
    {
      name: 'Unrealized P/L',
      colorVar: '--series-1',
      points: mySnapshots
        .filter((row) => row.pl !== null)
        .map((row) => ({ date: row.date, value: row.pl as number })),
    },
  ]

  const myEarnings = earnings
    .filter((row) => row.holdingIds.includes(holding.id))
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))

  const today = marketDate()
  const nextEarnings = [...myEarnings]
    .reverse()
    .find((row) => row.reportDate >= today)
  const pastEarnings = myEarnings.filter((row) => row.reportDate < today).slice(0, 8)

  const latestRec = recommendations[0]
  const openOrders = myOrders.filter(
    (order) => (order.status || 'Open').toLowerCase() === 'open'
  )

  return (
    <>
      <Link className="backlink" href="/">
        ← All positions
      </Link>

      <header className="masthead">
        <h1>
          {holding.ticker}
          <span
            style={{
              fontWeight: 400,
              fontSize: 16,
              color: 'var(--text-muted)',
              marginLeft: 10,
            }}
          >
            {holding.companyName}
          </span>
        </h1>
        <span className="meta">
          {holding.theme && <span className="badge">{holding.theme}</span>}
          {profile?.industry ? ` · ${profile.industry}` : ''}
          {profile?.marketCap ? ` · ${moneyCompact(profile.marketCap)} mkt cap` : ''}
        </span>
      </header>

      <div className="stats" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="label">Price</div>
          <div className="value">{money(holding.price)}</div>
          <div className={`sub ${toneFor(holding.dayChangePct)}`}>
            {signedPercent(holding.dayChangePct)} today
          </div>
        </div>
        <div className="stat">
          <div className="label">Position</div>
          <div className="value">{fmtShares(holding.totalShares)}</div>
          <div className="sub">{money(holding.avgCostPerShare)} avg cost</div>
        </div>
        <div className="stat">
          <div className="label">Market value</div>
          <div className="value">{money(holding.marketValue)}</div>
          <div className="sub">{money(holding.totalCostBasis)} cost basis</div>
        </div>
        <div className="stat">
          <div className="label">Unrealized P/L</div>
          <div className={`value ${toneFor(holding.unrealizedPl)}`}>
            {signedMoney(holding.unrealizedPl)}
          </div>
          <div className={`sub ${toneFor(holding.unrealizedPlPct)}`}>
            {signedPercent(holding.unrealizedPlPct)}
          </div>
        </div>
      </div>

      {holding.investmentThesis ? (
        <div className="card">
          <h2>Investment thesis</h2>
          <p className="thesis">{holding.investmentThesis}</p>
        </div>
      ) : (
        <div className="card">
          <h2>Investment thesis</h2>
          <p className="card-note">
            Nothing written yet. Add one in the Airtable{' '}
            <strong>Investment Thesis</strong> field on Holdings — why you bought
            it, and what would change your mind — and it will show here next to
            how the position has actually done.
          </p>
        </div>
      )}

      <div className="card" style={{ marginTop: 18 }}>
        <h2>
          Price
          {firstPurchase ? ` since first purchase · ${formatDate(firstPurchase)}` : ' · past year'}
        </h2>
        <LineChart
          title={`${ticker} closing price with purchase lots marked`}
          series={
            priceSeries
              ? [
                  {
                    name: ticker,
                    colorVar: '--series-1',
                    points: priceSeries.points.map((point) => ({
                      date: point.date,
                      value: point.close,
                    })),
                  },
                ]
              : []
          }
          markers={markers}
          formatValue={money}
          emptyMessage="Price history is unavailable right now. Live quotes above are unaffected."
        />
        {markers.length > 0 && (
          <p className="card-note" style={{ marginTop: 10 }}>
            Triangles mark purchase lots, labelled with share count.
          </p>
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>
          Versus SPY and QQQ
          {firstPurchase ? ' since first purchase' : ' · past year'}
        </h2>
        <LineChart
          title={`${ticker} percent change versus SPY and QQQ`}
          series={benchmarkSeries}
          formatValue={(value) => percent(value, 0)}
          showZeroLine
          emptyMessage="Benchmark history is unavailable right now."
        />
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Unrealized P/L over time</h2>
        {mySnapshots.length < 2 ? (
          <p className="card-note">
            {mySnapshots.length === 0
              ? 'No snapshots recorded yet.'
              : 'Only one snapshot so far — a line needs at least two.'}{' '}
            This chart builds from the Stock Snapshot table, which gets one row
            per day per holding, written when the dashboard is opened. History
            starts from the day this shipped and only accrues on days you visit.
          </p>
        ) : (
          <LineChart
            title={`${ticker} unrealized profit and loss over time`}
            series={plSeries}
            formatValue={money}
            showZeroLine
          />
        )}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Lots</h2>
        {myLots.length === 0 ? (
          <p className="card-note">No lots recorded.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Purchased</th>
                  <th className="num">Shares</th>
                  <th className="num">Price</th>
                  <th className="num">Fees</th>
                  <th className="num">Cost basis</th>
                  <th className="num">Held</th>
                  <th>Account</th>
                  <th>Broker</th>
                </tr>
              </thead>
              <tbody>
                {myLots.map((lot) => (
                  <tr key={lot.id}>
                    <td className="primary">{formatDate(lot.purchaseDate)}</td>
                    <td className="num">{fmtShares(lot.shares)}</td>
                    <td className="num">{money(lot.pricePerShare)}</td>
                    <td className="num">{money(lot.fees)}</td>
                    <td className="num">
                      {money(
                        lot.costBasis ?? lot.shares * lot.pricePerShare + lot.fees
                      )}
                    </td>
                    <td className="num">
                      {lot.daysHeld !== null
                        ? `${Math.round(lot.daysHeld)}d`
                        : lot.purchaseDate
                          ? `${daysBetween(lot.purchaseDate, today)}d`
                          : '—'}
                    </td>
                    <td>{lot.account || '—'}</td>
                    <td>{lot.broker || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openOrders.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <h2>Open orders</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th className="num">Qty</th>
                  <th className="num">Limit</th>
                  <th className="num">$ away</th>
                  <th className="num">% away</th>
                  <th>Expires</th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {openOrders.map((order) => (
                  <tr key={order.id}>
                    <td className="primary">{order.orderType || '—'}</td>
                    <td className="num">{fmtShares(order.quantity)}</td>
                    <td className="num">{money(order.limitPrice)}</td>
                    <td className="num">{money(order.dollarsAway)}</td>
                    <td className="num">{percent(order.pctAway)}</td>
                    <td>{formatDate(order.expires)}</td>
                    <td>{order.account || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <div className="card">
          <h2>Earnings</h2>
          {nextEarnings && (
            <p className="card-note" style={{ marginBottom: 12 }}>
              Next report <strong>{formatDate(nextEarnings.reportDate)}</strong>
              {nextEarnings.time ? ` (${nextEarnings.time})` : ''}
              {nextEarnings.epsEstimate !== null
                ? ` · ${nextEarnings.epsEstimate.toFixed(2)} EPS estimate`
                : ''}
            </p>
          )}

          {pastEarnings.length === 0 ? (
            <p className="card-note">
              No earnings recorded yet. Populate them with{' '}
              <code>POST /api/earnings</code> (optionally{' '}
              <code>{'{"ticker":"' + ticker + '"}'}</code>) to pull from Finnhub.
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th className="num">EPS est.</th>
                    <th className="num">EPS actual</th>
                    <th className="num">Surprise</th>
                  </tr>
                </thead>
                <tbody>
                  {pastEarnings.map((row) => (
                    <tr key={row.id}>
                      <td className="primary">{formatDate(row.reportDate)}</td>
                      <td className="num">
                        {row.epsEstimate !== null ? row.epsEstimate.toFixed(2) : '—'}
                      </td>
                      <td className="num">
                        {row.epsActual !== null ? row.epsActual.toFixed(2) : '—'}
                      </td>
                      <td className={`num ${toneFor(row.surprisePct)}`}>
                        {signedPercent(row.surprisePct, 1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2>Analyst recommendations</h2>
          {latestRec ? (
            <>
              <p className="card-note" style={{ marginBottom: 12 }}>
                As of {formatDate(latestRec.period)}
              </p>
              <RecommendationBar rec={latestRec} />
            </>
          ) : (
            <p className="card-note">No analyst coverage available.</p>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Recent news</h2>
        {news.length === 0 ? (
          <p className="card-note">No recent headlines.</p>
        ) : (
          <div>
            {news.slice(0, 8).map((item) => (
              <div className="news-item" key={item.id || item.url}>
                <a href={item.url} target="_blank" rel="noopener noreferrer">
                  {item.headline}
                </a>
                <div className="news-meta">
                  {item.source}
                  {item.datetime
                    ? ` · ${formatDate(
                        new Date(item.datetime * 1000).toISOString().slice(0, 10)
                      )}`
                    : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
