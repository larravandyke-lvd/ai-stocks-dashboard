# AI Stocks Dashboard

Next.js dashboard over the existing Airtable base (`appkYRfy8yg1iGxIh`). Airtable
stays the source of truth — this app reads it and writes back, it does not own
any data.

Live: https://ai-stocks-dashboard-sage.vercel.app

## Where the data comes from

| Source | Provides |
|---|---|
| Airtable | Holdings, Lots, Open Orders, Earnings, Stock Snapshot, Investment Thesis |
| Finnhub | Live quotes, earnings calendar, analyst recommendations, company news, profile |
| Yahoo chart endpoint | Daily closing prices for the charts and the SPY/QQQ benchmarks |

**Airtable owns share counts and cost basis; Finnhub owns the price.** Market
value and unrealized P/L are computed live from the two rather than read from
Airtable's formula fields, because those depend on the `Current Price` column,
which only changes when something writes to it. Reading them would show a P/L
calculated from whenever the base was last refreshed — stale by days on a quiet
week, while looking perfectly current.

### Why price history is not Finnhub

The build spec called for Finnhub `/stock/candle`. That endpoint is **paywalled
on the free tier** (verified: 403 `You don't have access to this resource`), and
it is what the price chart, the lot markers, and the benchmark overlay all
depend on. Stooq was evaluated and rejected — it now sits behind a JavaScript
proof-of-work bot wall a server-side fetch cannot clear. Yahoo's chart endpoint
is what's in use: free, keyless, and it returned clean daily bars for all seven
holdings plus SPY and QQQ.

It is also **undocumented** — no SLA, no support, and it can change without
notice. Every call is best-effort and degrades to "chart unavailable" rather
than throwing. Everything else on the page keeps working when it fails.

> ⚠️ **The `User-Agent` in `src/lib/history.ts` is load-bearing.** A bare
> `Mozilla/5.0` returns 200 every time; a realistic full Chrome UA and no UA at
> all both return **429** — on the first request from a cold client, on both
> `query1` and `query2`. It is not rate limiting. Do not "improve" that header
> into something more realistic; it will silently break every chart.

## Environment

| Variable | Required | Notes |
|---|---|---|
| `AIRTABLE_API_KEY` | yes | PAT scoped to `appkYRfy8yg1iGxIh` with `data.records:read`, `data.records:write`, `schema.bases:read` |
| `AIRTABLE_BASE_ID` | no | Defaults to `appkYRfy8yg1iGxIh` |
| `FINNHUB_API_KEY` | yes | Free tier is sufficient for everything used here |
| `ANTHROPIC_API_KEY` | only for uploads | Needed by `/api/trade-confirmation`; the rest of the app runs without it |

## Routes

| Route | Purpose |
|---|---|
| `/` | Totals, allocation by theme and position-size tier, day movers, holdings, open orders, upload widget |
| `/stock/[ticker]` | Thesis, price chart with lot markers, SPY/QQQ overlay, P/L history, lots, orders, earnings, analyst coverage, news |
| `GET /api/holdings` | Holdings with live-derived market value and P/L |
| `GET /api/lots?ticker=` | Lots, optionally filtered |
| `GET /api/orders?ticker=&status=` | Orders, optionally filtered |
| `GET /api/earnings?ticker=` | Stored earnings rows |
| `POST /api/earnings` | Refresh from Finnhub; body `{"ticker":"VRT"}` scopes it. Idempotent — keyed `TICKER YYYY-Qn`, so a re-run updates the quarter whose estimate became an actual instead of appending a duplicate |
| `GET /api/quote/[ticker]` | Live quote (keeps the Finnhub key server-side) |
| `GET /api/candles/[ticker]?from=&range=` | Daily closes. Named for the spec; does **not** proxy Finnhub — see above |
| `POST /api/trade-confirmation` | multipart → parse a PDF/image; JSON → commit reviewed trades |

## Snapshot-on-load

`src/lib/snapshot.ts` writes one Stock Snapshot row per held ticker per trading
day, triggered by a page load rather than a cron job. This was a deliberate
tradeoff: history accumulates only from the day this shipped, and only on days
the dashboard is actually opened. A week away is a week of gaps.

Rows are keyed `TICKER YYYY-MM-DD` and matched on that exact key rather than on
Airtable's `TODAY()`, which evaluates in UTC — after 8pm ET that would file an
evening snapshot under tomorrow and then skip the real one next morning. Dates
are computed in `America/New_York` throughout for the same reason.

Concurrent loads share one in-flight promise per date. Across serverless
instances the existence check can still race, which is what the `Key` column is
for: a duplicate is detectable rather than silently doubling a day.

## Trade confirmations

Two phases, deliberately. Uploading parses the document and shows the extracted
values in an editable form; **nothing is written until you confirm.** The parser
is good but not infallible, and a misread share count or price goes straight
into the cost basis where it is not obvious afterwards. A ticker with no
matching Holdings row is skipped and reported rather than invented.

Extraction uses `claude-opus-5` with structured outputs (`output_config.format`).
Assistant prefill — the old way of forcing JSON — returns a 400 on current
models.

Note the commit path uses Airtable `typecast`, so an unseen Broker or Account
string is accepted rather than failing. That is intended, but it means a
misspelling becomes a permanent select option until someone tidies the base.

## Charts

Server-rendered inline SVG with a CSS-only hover layer, so a chart ships zero
client JavaScript and still gets a crosshair and tooltip.

The benchmark overlay rebases every series to percent change from the first
shared bar. A second y-axis would be the obvious way to plot a $275 stock
against a $600 index, and the standard way to mislead with one.

Series colours come from a palette validated for colour-vision deficiency
against both the light and dark surfaces. Categorical slots are assigned in
fixed order and never cycled. If you change them, re-run the validator — do not
pick replacements by eye.

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev
```

`npm run typecheck` and `npm run build` both need to pass. If `tsc` reports
errors that contradict `tsconfig.json`, delete `tsconfig.tsbuildinfo` — stale
incremental state survives compiler-option changes.

## Deploy

```bash
vercel --prod
```

Project `ai-stocks-dashboard` under the `mmatchmaker` scope.
