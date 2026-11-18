export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function rmse(actual: number[], predicted: number[]): number {
  let sum = 0
  for (let i = 0; i < actual.length; i++) sum += (actual[i] - predicted[i]) ** 2
  return Math.sqrt(sum / actual.length)
}
