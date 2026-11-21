export const BENCH_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'comparison', label: 'Model comparison' },
  { id: 'data-size', label: 'Training size' },
  { id: 'forecast', label: 'Forecasts' },
  { id: 'methods', label: 'Methods & limits' },
] as const
export type BenchTab = (typeof BENCH_TABS)[number]['id']
