// Types for public/decision.json, written by benchmark/decision/export.py

export interface Spread {
  mean: number
  min: number
  max: number
}

export type MethodId = 'naive_yesterday' | 'naive_last_week' | 'linear' | 'mlp' | 'rf'
export type StrategyId = 'perfect_foresight' | MethodId
export type Planner = 'plain' | 'flatten'

export interface Accuracy {
  method: MethodId
  seeds: number
  rmse: Spread
  mae: Spread
  peak_mae: Spread
  peak_under_share: Spread
  train_time_s: Spread
  predict_ms_per_day: Spread
}

export interface BacktestMethod {
  method: StrategyId
  seeds: number
  total: Spread
  saving: Spread
  saving_pct: Spread
  share_of_perfect: Spread
  excess: Spread
  energy_delta: Spread
  basic_delta: Spread
  excess_delta: Spread
  months_with_excess: Spread
  max_demand_kw: Spread
}

export interface FlattenMethod {
  method: StrategyId
  seeds: number
  total: Spread
  saving: Spread
  share_of_plain_perfect: Spread
  excess: Spread
  months_with_excess: Spread
  over_contract_slots: Spread
}

export interface Sensitivity {
  battery_hours: number
  tariff_shift_h: number
  method: StrategyId
  contract_kw: number
  share_of_perfect: Spread
  saving: Spread
}

export interface MarginRow {
  method: MethodId
  quantile: number
  margin_kw: Spread
  share_of_perfect: Spread
  excess: Spread
  energy_delta: Spread
}

export interface MonthRow {
  month: string
  method: 'no_battery' | StrategyId
  excess: number
  max_demand_kw: number
  total: number
}

export interface DayPlan {
  grid: number[]
  charge: number[]
  discharge: number[]
}

export interface Day {
  day: string
  month: string
  worst_over_kw: number
  worst_at: string
  worst_period: string
  period: ('peak' | 'semi_peak' | 'off_peak')[]
  price: number[]
  actual: number[]
  forecasts: Record<string, number[]>
  /** key: "<strategy>|<planner>", e.g. "mlp_s42|flatten" */
  plans: Record<string, DayPlan>
}

export interface PlannerResult {
  share: Record<MethodId, number>
  model_gap: number
  seed_spread: number
  best: MethodId
  rank_corr_rmse: number
  rank_corr_peak: number
}

export interface ClientResult {
  client: string
  mean_load_kw: number
  contract_no_battery_kw: number
  contract_battery_kw: number
  perfect_saving_pct: number
  best_rmse: MethodId
  plain: PlannerResult
  flatten: PlannerResult
}

interface PlannerSummary {
  gap_above_seed_spread: number
  median_model_gap: number
  median_rank_corr_rmse: number
  median_rank_corr_peak: number
  learned_beats_naive: number
  mean_share: Record<MethodId, number>
}

export interface ClientRun {
  client: string
  planner: Planner
  method: 'no_battery' | StrategyId
  seed: number | null
  share: number
  saving: number
  excess: number
  total: number
  months_with_excess: number
}

export interface ClientAccuracy {
  client: string
  method: MethodId
  seed: number | null
  rmse: number
  peak_mae: number
}

export interface MultiClient {
  runs: ClientRun[]
  accuracy: ClientAccuracy[]
  rule: { window: [string, string]; max_zero_day_share: number; min_mean_kw: number; seed: number }
  clients_total: number
  eligible: number
  clients: ClientResult[]
  summary: {
    flatten_helps_all_methods: number
    flatten_gain_mean: number
    flatten_gain_min: number
    flatten_gain_max: number
  } & { [K in `${Planner}_${keyof PlannerSummary}`]: K extends `${Planner}_${infer F extends keyof PlannerSummary}` ? PlannerSummary[F] : never }
}

export interface Decision {
  meta: {
    generated_at: string
    git_commit: string | null
    test_start: string
    test_end: string
    test_days: number
    calibration_start: string
    calibration_end: string
    battery: { hours: number; capacity_kwh: number; power_kw: number; round_trip_efficiency: number }
    tariff: {
      name: string
      currency: string
      source: { document: string; url: string; retrieved: string }
      summer: string
      basic_per_kw_month: Record<'summer' | 'non_summer', number>
      off_peak_contract_per_kw_month: Record<'summer' | 'non_summer', number>
      energy_per_kwh: Record<'summer' | 'non_summer', Record<'peak' | 'semi_peak' | 'off_peak', number>>
      periods: Record<'summer' | 'non_summer', Record<'weekday' | 'saturday' | 'sunday', string[]>>
      excess_multiples: [number, number]
    }
    worst_day_plan: string
  }
  accuracy: Accuracy[]
  backtest: {
    flatten_weight: number
    flatten: FlattenMethod[]
    contract_no_battery_kw: number
    contract_battery_kw: number
    no_battery_total: number
    no_battery_excess: number
    methods: BacktestMethod[]
    sensitivity: Sensitivity[]
    monthly: MonthRow[]
    margin: MarginRow[]
  }
  overruns: Record<Planner, { strategy: string; over_slots: number; over_while_charging: number }[]>
  days: Day[]
  /** The ten-client check; null until benchmark.multiclient has been run */
  multiclient: MultiClient | null
}

export const METHOD_LABELS: Record<StrategyId, string> = {
  perfect_foresight: 'Perfect foresight',
  naive_yesterday: 'Same time yesterday',
  naive_last_week: 'Same time last week',
  linear: 'Linear regression',
  mlp: 'MLP',
  rf: 'Random forest',
}

/** Theme color key and line style for each strategy */
export const METHOD_STYLE: Record<StrategyId, { color: 'perfect' | 'naive' | 'linear' | 'mlp' | 'rf'; dashed?: boolean }> = {
  perfect_foresight: { color: 'perfect' },
  naive_yesterday: { color: 'naive' },
  naive_last_week: { color: 'naive', dashed: true },
  linear: { color: 'linear' },
  mlp: { color: 'mlp' },
  rf: { color: 'rf' },
}

export const METHODS: MethodId[] = ['naive_yesterday', 'naive_last_week', 'linear', 'mlp', 'rf']

export async function loadDecision(): Promise<Decision> {
  const response = await fetch(`${import.meta.env.BASE_URL}decision.json`)
  const isJson = (response.headers.get('content-type') ?? '').includes('json')
  if (!response.ok || !isJson) throw new Error('The decision results file (decision.json) is missing or is not valid JSON')
  return (await response.json()) as Decision
}
