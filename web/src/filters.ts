import type { ModelId, Results, Run } from './data.ts'

/** Sidebar state shared by every tab, like the Streamlit control panel */
export interface Filters {
  size: number
  memoryLimitMb: number
  latencyLimitMs: number
  models: ModelId[]
}

export const ALL_MODELS: ModelId[] = ['naive', 'linear', 'mlp', 'rf']

export function defaultFilters(results: Results): Filters {
  const sizes = results.meta.dataset_sizes
  return {
    size: sizes[sizes.length - 1],
    memoryLimitMb: maxOf(results.runs, 'rss_delta_mb'),
    latencyLimitMs: maxOf(results.runs, 'latency_ms_median'),
    models: ALL_MODELS,
  }
}

export function maxOf(runs: Run[], key: 'rss_delta_mb' | 'latency_ms_median'): number {
  return Math.max(...runs.map((r) => r[key] ?? 0))
}

/** Runs that pass the model selection and both budgets (any training size) */
export function withinBudget(runs: Run[], f: Filters): Run[] {
  return runs.filter(
    (r) =>
      f.models.includes(r.model) &&
      (r.rss_delta_mb ?? 0) <= f.memoryLimitMb &&
      (r.latency_ms_median ?? 0) <= f.latencyLimitMs,
  )
}
