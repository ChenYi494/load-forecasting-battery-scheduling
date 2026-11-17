// Types for public/results.json, written by scripts/export_results.py

export type ModelId = 'naive' | 'linear' | 'mlp' | 'rf'

export interface Stat {
  median: number | null
  min: number | null
  max: number | null
}

export type MetricKey =
  | 'rmse'
  | 'mae'
  | 'train_time_s'
  | 'rss_delta_mb'
  | 'model_size_mb'
  | 'latency_ms_median'
  | 'latency_ms_p95'

export interface Group extends Record<MetricKey, Stat> {
  model: ModelId
  dataset_size: number
  runs: number
}

export interface Run extends Record<MetricKey, number | null> {
  exp_name: string
  model: ModelId
  dataset_size: number
  seed: number
  variant: string
  effective_epochs: number
}

export interface Baseline {
  variant: string
  lag_col: 'lag_1' | 'lag_96'
  rmse: number
  mae: number
}

export interface BeforeGroup {
  model: Exclude<ModelId, 'naive'>
  dataset_size: number
  runs: number
  rmse_median: number | null
  mae_median: number | null
}

export interface ForecastWeek {
  start: string
  end: string
  timestamps: string[]
  actual: number[]
  series: Record<string, number[]>
  labels: Record<string, string>
}

export interface Extrapolation {
  key: string
  label: string
  train_max_kw: number
  share_test_above_train_max: number
  rmse_rows_above: number | null
  rmse_rows_within: number | null
}

export interface BestRun {
  exp_name: string
  model: ModelId
  dataset_size: number
  rmse: number
  vs_persistence_pct: number
}

export interface Results {
  meta: {
    generated_at: string
    git_commit: string | null
    dataset: string
    dataset_url: string
    client: string
    unit: string
    interval_minutes: number
    rows: number
    target: string
    features: string[]
    test_start: string
    test_end: string
    test_rows: number
    dataset_sizes: number[]
    runs: number
    hardware: Record<string, string | number>
    protocol: Record<string, string>
  }
  baselines: Baseline[]
  groups: Group[]
  runs: Run[]
  before: BeforeGroup[]
  forecast_week: ForecastWeek
  findings: {
    best_run: BestRun
    best_by_size: BestRun[]
    rf_memory_100k_vs_linear_mb: [Stat, Stat]
    extrapolation: Extrapolation[]
  }
}

export const MODEL_LABELS: Record<ModelId, string> = {
  naive: 'Naive baseline',
  linear: 'Linear regression',
  mlp: 'MLP',
  rf: 'Random forest',
}

export async function loadResults(): Promise<Results> {
  const response = await fetch(`${import.meta.env.BASE_URL}results.json`)
  if (!response.ok) throw new Error(`results.json could not be loaded (HTTP ${response.status})`)
  return (await response.json()) as Results
}
