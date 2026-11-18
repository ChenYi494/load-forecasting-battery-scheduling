const nf = (digits: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })

export function num(value: number | null | undefined, digits = 1): string {
  return value == null ? '—' : nf(digits).format(value)
}

export function int(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}

export function pct(value: number, digits = 1): string {
  return `${value > 0 ? '+' : ''}${nf(digits).format(value)}%`
}

/** "2014-03-14 22:30:00" -> "14 Mar 2014" */
export function day(timestamp: string): string {
  const d = new Date(timestamp.replace(' ', 'T'))
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
