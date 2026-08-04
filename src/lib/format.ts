// Display formatting. Safe to import from client components.

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const USD_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
})

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return USD.format(value)
}

/** Compact form for axis labels and large revenue figures. */
export function moneyCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return USD_COMPACT.format(value)
}

export function signedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : '−'}${USD.format(Math.abs(value))}`
}

/**
 * Airtable percent fields store 0.0412 for 4.12%, and so does Finnhub's `dp`
 * — except Finnhub sends 4.12. Callers pass an already-normalised fraction;
 * the Finnhub adapter divides before it gets here.
 */
export function percent(fraction: number | null | undefined, digits = 2): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return '—'
  }
  return `${(fraction * 100).toFixed(digits)}%`
}

export function signedPercent(
  fraction: number | null | undefined,
  digits = 2
): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return '—'
  }
  const sign = fraction >= 0 ? '+' : '−'
  return `${sign}${(Math.abs(fraction) * 100).toFixed(digits)}%`
}

export function shares(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // Fractional-share purchases are common here (13.002 VRT), so trailing
  // precision matters, but whole lots should not render as "700.000".
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

/** Tailwind-free class hook for red/green, used by both pages. */
export function toneFor(value: number | null | undefined): 'up' | 'down' | 'flat' {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'flat'
  if (value > 0) return 'up'
  if (value < 0) return 'down'
  return 'flat'
}
