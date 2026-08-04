// Inline-SVG charts.
//
// These are server components on purpose: the hover layer is pure CSS
// (`.hover-slot:hover .hover-group`), so a chart ships zero client JavaScript
// and still gets a crosshair and tooltip. That keeps the dashboard fast and
// avoids hydrating a chart library for what are, at most, three line series.
//
// Colour rules in force here:
//   - categorical slots are assigned in fixed order and never cycled
//   - a single series carries no legend (the card title names it)
//   - two or more series get BOTH a legend and direct labels, so identity is
//     never carried by colour alone
//   - value text uses ink tokens, never the series colour

import Link from 'next/link'

import { formatDate } from '@/lib/dates'
import {
  money,
  moneyCompact,
  shares as formatShares,
  signedPercent,
} from '@/lib/format'

export type Series = {
  name: string
  /** CSS custom property name, e.g. `--series-1`. Fixed order, never by rank. */
  colorVar: string
  points: { date: string; value: number }[]
}

export type LotMarker = {
  /** Where the marker is drawn. Clamped to the first bar for pre-chart lots. */
  date: string
  /** The real purchase date, shown on hover. May differ from `date` above. */
  actualDate: string
  price: number
  shares: number
}

const W = 720
const H = 260
const PAD = { top: 18, right: 64, bottom: 26, left: 52 }

const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return []
  if (min === max) return [min]
  const span = max - min
  const rawStep = span / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const normalized = rawStep / magnitude
  const step =
    (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) *
    magnitude

  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max + step * 0.001; t += step) {
    ticks.push(Number(t.toFixed(10)))
  }
  return ticks
}

export function LineChart({
  series,
  markers = [],
  formatValue,
  showZeroLine = false,
  emptyMessage = 'No data yet.',
  title,
}: {
  series: Series[]
  markers?: LotMarker[]
  formatValue: (value: number) => string
  showZeroLine?: boolean
  emptyMessage?: string
  title: string
}) {
  const live = series.filter((s) => s.points.length > 0)

  if (live.length === 0) {
    return <div className="chart-empty">{emptyMessage}</div>
  }

  // Series can cover different date ranges (a benchmark starts the day the
  // first lot was bought; a snapshot series starts the day this shipped), so
  // x is indexed off the union of dates rather than off any one series.
  const dates = [...new Set(live.flatMap((s) => s.points.map((p) => p.date)))].sort()
  const indexOf = new Map(dates.map((date, i) => [date, i]))

  const values = live.flatMap((s) => s.points.map((p) => p.value))
  const markerValues = markers.map((m) => m.price)
  const all = [...values, ...markerValues]

  let min = Math.min(...all)
  let max = Math.max(...all)
  if (showZeroLine) {
    min = Math.min(min, 0)
    max = Math.max(max, 0)
  }
  if (min === max) {
    min -= Math.abs(min || 1) * 0.05
    max += Math.abs(max || 1) * 0.05
  }
  const headroom = (max - min) * 0.08
  min -= headroom
  max += headroom

  const xFor = (date: string) => {
    const i = indexOf.get(date) ?? 0
    return dates.length === 1
      ? PAD.left + PLOT_W / 2
      : PAD.left + (i / (dates.length - 1)) * PLOT_W
  }
  const yFor = (value: number) =>
    PAD.top + PLOT_H - ((value - min) / (max - min)) * PLOT_H

  const yTicks = niceTicks(min, max, 4)

  // ~5 x labels, always including the last.
  const labelStep = Math.max(1, Math.ceil(dates.length / 5))
  const xLabelIndexes = dates
    .map((_, i) => i)
    .filter((i) => i % labelStep === 0 || i === dates.length - 1)

  const multi = live.length > 1

  return (
    <>
      {multi && (
        <div className="legend">
          {live.map((s) => (
            <span className="legend-item" key={s.name}>
              <span
                className="swatch"
                style={{ background: `var(${s.colorVar})` }}
                aria-hidden="true"
              />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Gridlines stay recessive — they orient, they don't compete. */}
        {yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              className="gridline"
              x1={PAD.left}
              x2={PAD.left + PLOT_W}
              y1={yFor(tick)}
              y2={yFor(tick)}
            />
            <text
              className="tick"
              x={PAD.left - 8}
              y={yFor(tick)}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {showZeroLine && min < 0 && max > 0 && (
          <line
            className="zero-line"
            x1={PAD.left}
            x2={PAD.left + PLOT_W}
            y1={yFor(0)}
            y2={yFor(0)}
          />
        )}

        <line
          className="axis-line"
          x1={PAD.left}
          x2={PAD.left + PLOT_W}
          y1={PAD.top + PLOT_H}
          y2={PAD.top + PLOT_H}
        />

        {xLabelIndexes.map((i) => (
          <text
            className="tick"
            key={`x-${dates[i]}`}
            x={xFor(dates[i])}
            y={H - 8}
            textAnchor={i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle'}
          >
            {formatDate(dates[i]).replace(/, \d{4}$/, '')}
          </text>
        ))}

        {live.map((s) => {
          const d = s.points
            .map(
              (p, i) =>
                `${i === 0 ? 'M' : 'L'}${xFor(p.date).toFixed(2)},${yFor(
                  p.value
                ).toFixed(2)}`
            )
            .join(' ')
          return (
            <path
              key={s.name}
              className="series-line"
              d={d}
              stroke={`var(${s.colorVar})`}
            />
          )
        })}

        {/* Direct labels at each series' last point. Required relief for the
            light-mode slots that sit below 3:1 against the surface. */}
        {multi &&
          live.map((s) => {
            const last = s.points[s.points.length - 1]
            return (
              <text
                key={`label-${s.name}`}
                className="direct-label"
                x={xFor(last.date) + 8}
                y={yFor(last.value)}
                dominantBaseline="middle"
                fill={`var(${s.colorVar})`}
              >
                {s.name}
              </text>
            )
          })}

        {/* Lot markers: annotations, not a series — ink + a surface ring so
            they read as a different kind of thing from the price line. */}
        {markers.map((marker, i) => {
          const x = xFor(marker.date)
          const y = yFor(marker.price)
          return (
            <g key={`marker-${marker.date}-${i}`}>
              <path
                className="lot-marker"
                d={`M${x},${y - 6} L${x + 5.5},${y + 4} L${x - 5.5},${y + 4} Z`}
                fill="var(--text-primary)"
              />
              <text
                className="lot-label"
                x={x}
                y={y - 11}
                textAnchor="middle"
              >
                {formatShares(marker.shares)}
              </text>
            </g>
          )
        })}

        {/* Hover layer. One slot per date; CSS reveals the matching tooltip. */}
        {dates.map((date, i) => {
          const x = xFor(date)
          const bandW = dates.length === 1 ? PLOT_W : PLOT_W / (dates.length - 1)
          const rows = live
            .map((s) => ({
              name: s.name,
              colorVar: s.colorVar,
              point: s.points.find((p) => p.date === date),
            }))
            .filter((row) => row.point)

          if (rows.length === 0) return null

          const tipW = multi ? 148 : 116
          const tipH = 20 + rows.length * 15
          const flip = x > PAD.left + PLOT_W * 0.62
          const tipX = flip ? x - tipW - 10 : x + 10
          const tipY = Math.min(PAD.top + 4, PAD.top + PLOT_H - tipH)

          return (
            <g className="hover-slot" key={`hover-${date}`}>
              <rect
                className="hover-band"
                x={x - bandW / 2}
                y={PAD.top}
                width={bandW}
                height={PLOT_H}
              />
              <g className="hover-group">
                <line
                  className="crosshair"
                  x1={x}
                  x2={x}
                  y1={PAD.top}
                  y2={PAD.top + PLOT_H}
                />
                {rows.map((row) => (
                  <circle
                    key={`dot-${row.name}`}
                    cx={x}
                    cy={yFor(row.point!.value)}
                    r={4}
                    fill={`var(${row.colorVar})`}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  />
                ))}
                <rect
                  className="tip-box"
                  x={tipX}
                  y={tipY}
                  width={tipW}
                  height={tipH}
                  rx={6}
                />
                <text className="tip-muted" x={tipX + 10} y={tipY + 15}>
                  {formatDate(date)}
                </text>
                {rows.map((row, ri) => (
                  <text
                    key={`tip-${row.name}`}
                    className="tip-text"
                    x={tipX + 10}
                    y={tipY + 32 + ri * 15}
                  >
                    {multi ? `${row.name}  ` : ''}
                    {formatValue(row.point!.value)}
                  </text>
                ))}
              </g>
            </g>
          )
        })}

        {/* Lot hover targets render LAST so they sit above the date bands —
            SVG paints in document order, and an earlier band would otherwise
            swallow the pointer before it reached the marker. */}
        {markers.map((marker, i) => {
          const x = xFor(marker.date)
          const y = yFor(marker.price)
          const tipW = 132
          const tipH = 56
          const flip = x > PAD.left + PLOT_W * 0.6
          const tipX = flip ? x - tipW - 12 : x + 12
          const tipY = Math.max(PAD.top + 2, Math.min(y - tipH / 2, PAD.top + PLOT_H - tipH))

          return (
            <g className="hover-slot" key={`lot-hover-${marker.actualDate}-${i}`}>
              {/* Invisible target, deliberately larger than the 11px triangle
                  so the marker is reachable without pixel-hunting. */}
              <circle className="hover-band" cx={x} cy={y} r={14} />
              <g className="hover-group">
                <circle
                  cx={x}
                  cy={y}
                  r={7}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth={1.5}
                />
                <rect
                  className="tip-box"
                  x={tipX}
                  y={tipY}
                  width={tipW}
                  height={tipH}
                  rx={6}
                />
                <text className="tip-muted" x={tipX + 10} y={tipY + 16}>
                  Bought {formatDate(marker.actualDate)}
                </text>
                <text className="tip-text" x={tipX + 10} y={tipY + 33}>
                  {formatShares(marker.shares)} sh @ {money(marker.price)}
                </text>
                <text className="tip-muted" x={tipX + 10} y={tipY + 48}>
                  {money(marker.shares * marker.price)} cost
                </text>
              </g>
            </g>
          )
        })}
      </svg>
    </>
  )
}

/**
 * Part-to-whole by market value. Every slice is directly labelled in the
 * legend beside it — which is also the relief that lets the lighter
 * categorical slots be used on a light surface — and both the slice and its
 * legend row link through to the position.
 */
export function DonutChart({
  rows,
  total,
}: {
  rows: { label: string; value: number; share: number; href?: string }[]
  total: number
}) {
  if (rows.length === 0) {
    return <p className="card-note">Nothing to allocate yet.</p>
  }

  const CX = 95
  const CY = 95
  const R_OUT = 88
  const R_IN = 55

  let angle = -Math.PI / 2 // start at 12 o'clock

  const slices = rows.map((row, index) => {
    const sweep = row.share * Math.PI * 2
    const start = angle
    const end = angle + sweep
    angle = end

    const x0 = CX + R_OUT * Math.cos(start)
    const y0 = CY + R_OUT * Math.sin(start)
    const x1 = CX + R_OUT * Math.cos(end)
    const y1 = CY + R_OUT * Math.sin(end)
    const x2 = CX + R_IN * Math.cos(end)
    const y2 = CY + R_IN * Math.sin(end)
    const x3 = CX + R_IN * Math.cos(start)
    const y3 = CY + R_IN * Math.sin(start)
    const large = sweep > Math.PI ? 1 : 0

    // A single holding at 100% cannot be drawn as an arc — start and end
    // coincide, so the path collapses to nothing. Draw two half-rings.
    const d =
      row.share >= 0.9999
        ? `M${CX - R_OUT},${CY} A${R_OUT},${R_OUT} 0 1 1 ${CX + R_OUT},${CY} A${R_OUT},${R_OUT} 0 1 1 ${CX - R_OUT},${CY} Z ` +
          `M${CX - R_IN},${CY} A${R_IN},${R_IN} 0 1 0 ${CX + R_IN},${CY} A${R_IN},${R_IN} 0 1 0 ${CX - R_IN},${CY} Z`
        : `M${x0.toFixed(2)},${y0.toFixed(2)} ` +
          `A${R_OUT},${R_OUT} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} ` +
          `L${x2.toFixed(2)},${y2.toFixed(2)} ` +
          `A${R_IN},${R_IN} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z`

    return { ...row, d, colorVar: `--series-${(index % 7) + 1}` }
  })

  return (
    <div className="donut-layout">
      <svg
        className="donut-svg"
        viewBox="0 0 190 190"
        role="img"
        aria-label={`Allocation by market value: ${rows
          .map((row) => `${row.label} ${(row.share * 100).toFixed(1)} percent`)
          .join(', ')}`}
      >
        {slices.map((slice) => {
          const path = (
            <path
              className="donut-slice"
              d={slice.d}
              fill={`var(${slice.colorVar})`}
              fillRule="evenodd"
            />
          )
          // Plain anchor rather than next/link: inside an SVG the element is
          // created in the SVG namespace, where the router's click handling
          // does not apply.
          return slice.href ? (
            <a href={slice.href} key={slice.label}>
              {path}
            </a>
          ) : (
            <g key={slice.label}>{path}</g>
          )
        })}
        <text className="donut-center-value" x={CX} y={CY - 2}>
          {moneyCompact(total)}
        </text>
        <text className="donut-center-label" x={CX} y={CY + 13}>
          Market value
        </text>
      </svg>

      <div className="donut-legend">
        {slices.map((slice) => {
          const inner = (
            <>
              <span className="sym">
                <span
                  className="swatch"
                  style={{ background: `var(${slice.colorVar})` }}
                  aria-hidden="true"
                />
                {slice.label}
              </span>
              <span className="val">{money(slice.value)}</span>
              <span className="pct">{(slice.share * 100).toFixed(1)}%</span>
            </>
          )
          return slice.href ? (
            <Link className="donut-row" href={slice.href} key={slice.label}>
              {inner}
            </Link>
          ) : (
            <div className="donut-row" key={slice.label}>
              {inner}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Diverging bars for P/L %, growing left or right from a shared zero line.
 *
 * Colour is the status ramp rather than a categorical slot — gain and loss are
 * states, not series identities. Sign is never carried by colour alone: it is
 * in the signed value label and in which side of the zero line the bar sits on.
 */
export function PLBars({
  rows,
}: {
  rows: { label: string; value: number; href?: string }[]
}) {
  if (rows.length === 0) {
    return <p className="card-note">No positions to compare yet.</p>
  }

  const widest = Math.max(...rows.map((row) => Math.abs(row.value)), 0.0001)

  return (
    <div>
      {rows.map((row) => {
        const positive = row.value >= 0
        // Half the track is available on each side of the zero line.
        const width = (Math.abs(row.value) / widest) * 50
        const inner = (
          <>
            <span className="plbar-sym">{row.label}</span>
            <span className="plbar-track">
              <span className="plbar-zero" />
              <span
                className={`plbar-fill ${positive ? 'pos' : 'neg'}`}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className={`plbar-value ${positive ? 'up' : 'down'}`}>
              {signedPercent(row.value)}
            </span>
          </>
        )
        return row.href ? (
          <Link className="plbar-row" href={row.href} key={row.label}>
            {inner}
          </Link>
        ) : (
          <div className="plbar-row" key={row.label}>
            {inner}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Horizontal magnitude bars for allocation breakdowns. Every row is directly
 * labelled with its name and figures, which is also the relief that lets the
 * lighter categorical slots be used on a light surface.
 */
export function AllocationBars({
  rows,
  formatValue,
}: {
  rows: { label: string; value: number; share: number }[]
  formatValue: (value: number) => string
}) {
  if (rows.length === 0) {
    return <p className="card-note">Nothing to allocate yet.</p>
  }

  const max = Math.max(...rows.map((row) => row.share), 0.0001)

  return (
    <div>
      {rows.map((row, i) => (
        <div className="alloc-row" key={row.label}>
          <div className="alloc-head">
            <span className="label">
              <span
                className="swatch"
                style={{ background: `var(--series-${(i % 5) + 1})` }}
                aria-hidden="true"
              />
              {row.label}
            </span>
            <span className="figures">
              {formatValue(row.value)} · {(row.share * 100).toFixed(1)}%
            </span>
          </div>
          <div className="alloc-track">
            <div
              className="alloc-fill"
              style={{
                width: `${Math.max((row.share / max) * 100, 1.5)}%`,
                background: `var(--series-${(i % 5) + 1})`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Analyst recommendation distribution. Uses the status ramp rather than the
 * categorical slots — these are states (buy/hold/sell), not series identities —
 * and every segment is labelled, so colour is never the only cue.
 */
export function RecommendationBar({
  rec,
}: {
  rec: {
    strongBuy: number
    buy: number
    hold: number
    sell: number
    strongSell: number
  }
}) {
  const segments = [
    { label: 'Strong buy', count: rec.strongBuy, color: 'var(--good)' },
    {
      label: 'Buy',
      count: rec.buy,
      color: 'color-mix(in srgb, var(--good) 60%, var(--surface))',
    },
    { label: 'Hold', count: rec.hold, color: 'var(--warning)' },
    {
      label: 'Sell',
      count: rec.sell,
      color: 'color-mix(in srgb, var(--critical) 65%, var(--surface))',
    },
    { label: 'Strong sell', count: rec.strongSell, color: 'var(--critical)' },
  ]

  const total = segments.reduce((sum, segment) => sum + segment.count, 0)
  if (total === 0) return <p className="card-note">No analyst coverage.</p>

  return (
    <div>
      <div className="rec-bar" role="img" aria-label={
        segments.map((s) => `${s.label} ${s.count}`).join(', ')
      }>
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <div
              className="rec-seg"
              key={segment.label}
              style={{
                width: `${(segment.count / total) * 100}%`,
                background: segment.color,
              }}
            />
          ))}
      </div>
      <div className="legend" style={{ marginTop: 10, marginBottom: 0 }}>
        {segments
          .filter((segment) => segment.count > 0)
          .map((segment) => (
            <span className="legend-item" key={segment.label}>
              <span
                className="swatch"
                style={{ background: segment.color }}
                aria-hidden="true"
              />
              {segment.label} · {segment.count}
            </span>
          ))}
      </div>
    </div>
  )
}
