import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { MODEL_LABELS, type MetricKey, type Results, type Run } from '../data.ts'
import type { Filters } from '../filters.ts'
import { int, num } from '../format.ts'
import { median } from '../stats.ts'

const X_OPTIONS: { key: MetricKey; label: string; unit: string; digits: number }[] = [
  { key: 'rss_delta_mb', label: 'Training memory', unit: 'MB', digits: 1 },
  { key: 'latency_ms_median', label: 'Latency per row', unit: 'ms', digits: 3 },
  { key: 'train_time_s', label: 'Training time', unit: 's', digits: 3 },
]

const COLUMNS: { key: MetricKey; label: string; digits: number }[] = [
  { key: 'rmse', label: 'RMSE (kW)', digits: 1 },
  { key: 'mae', label: 'MAE (kW)', digits: 1 },
  { key: 'train_time_s', label: 'Train time (s)', digits: 3 },
  { key: 'rss_delta_mb', label: 'Memory (MB)', digits: 1 },
  { key: 'model_size_mb', label: 'Model size (MB)', digits: 3 },
  { key: 'latency_ms_median', label: 'Latency (ms/row)', digits: 3 },
]

interface Row {
  id: string
  model: Run['model']
  name: string
  runs: number
  values: Record<MetricKey, number | null>
  rmseRange: [number | null, number | null]
}

export default function Comparison({ results, filters, passing }: { results: Results; filters: Filters; passing: Run[] }) {
  const theme = useTheme()
  const [xKey, setXKey] = useState<MetricKey>('rss_delta_mb')
  const [logX, setLogX] = useState(true)
  const [sort, setSort] = useState<{ key: MetricKey; asc: boolean }>({ key: 'rmse', asc: true })
  const persistence = results.baselines.find((b) => b.lag_col === 'lag_1')!

  const atSize = passing.filter((r) => r.dataset_size === filters.size)

  // One row per model (median over every configuration and seed); baselines get one row each
  const rows: Row[] = useMemo(() => {
    const out: Row[] = []
    for (const model of filters.models) {
      const runs = atSize.filter((r) => r.model === model)
      if (runs.length === 0) continue
      const parts = model === 'naive' ? [...new Set(runs.map((r) => r.variant))].map((v) => runs.filter((r) => r.variant === v)) : [runs]
      for (const part of parts) {
        const med = (k: MetricKey) => median(part.map((r) => r[k]).filter((v): v is number => v != null))
        const rmses = part.map((r) => r.rmse!).filter((v) => v != null)
        out.push({
          id: model + part[0].variant,
          model,
          name: model === 'naive' ? part[0].variant : MODEL_LABELS[model],
          runs: part.length,
          values: Object.fromEntries(COLUMNS.map((c) => [c.key, med(c.key)])) as Record<MetricKey, number | null>,
          rmseRange: [Math.min(...rmses), Math.max(...rmses)],
        })
      }
    }
    return out.sort((a, b) => {
      const av = a.values[sort.key] ?? Infinity
      const bv = b.values[sort.key] ?? Infinity
      return sort.asc ? av - bv : bv - av
    })
  }, [atSize, filters.models, sort])

  const x = X_OPTIONS.find((o) => o.key === xKey)!
  const scatter = atSize.filter((r) => r.model !== 'naive' && (r[xKey] ?? 0) > 0)

  const option = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 44, right: 16, top: 44, bottom: 52 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: {
        trigger: 'item',
        formatter: (p) => {
          const r = (p as unknown as { data: { run: Run } }).data.run
          return `<b>${MODEL_LABELS[r.model]}</b><br/>${r.variant}, seed ${r.seed}<br/>RMSE ${num(r.rmse, 2)} kW<br/>${x.label} ${num(r[xKey], x.digits)} ${x.unit}`
        },
      },
      xAxis: {
        type: logX ? 'log' : 'value',
        name: `${x.label} (${x.unit})${logX ? ', log scale' : ''}`,
        nameLocation: 'middle',
        nameGap: 30,
        nameTextStyle: { color: theme.muted },
        axisLabel: { color: theme.muted },
        splitLine: { lineStyle: { color: theme.line } },
      },
      yAxis: {
        type: 'value',
        scale: true,
        // Keep the persistence line in view so "below the line" is visible
        max: Math.ceil(Math.max(persistence.rmse, ...scatter.map((r) => r.rmse ?? 0)) + 1),
        axisLabel: { color: theme.muted },
        splitLine: { lineStyle: { color: theme.line } },
      },
      series: (['linear', 'mlp', 'rf'] as const)
        .filter((m) => filters.models.includes(m))
        .map((m, i) => ({
          name: MODEL_LABELS[m],
          type: 'scatter',
          symbolSize: 9,
          itemStyle: { color: theme.series[m], opacity: 0.85, borderColor: theme.surface, borderWidth: 1 },
          data: scatter.filter((r) => r.model === m).map((r) => ({ value: [r[xKey], r.rmse], run: r })),
          ...(i === 0
            ? {
                markLine: {
                  symbol: 'none',
                  silent: true,
                  lineStyle: { color: theme.series.naive, type: 'dashed', width: 1.5 },
                  label: { formatter: `Persistence ${num(persistence.rmse, 1)}`, color: theme.muted, position: 'insideEndTop' },
                  data: [{ yAxis: persistence.rmse }],
                },
              }
            : {}),
        })),
    }),
    [theme, scatter, xKey, logX, x, filters.models, persistence.rmse],
  )

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <div className="panel-h">
          <h2>Models at {int(filters.size)} training rows</h2>
          <span className="muted">Median over configurations and seeds · runs outside the budget are excluded · click a column to sort</span>
        </div>
        {rows.length === 0 ? (
          <p className="empty">No run at this size meets the budget. Raise the limits in the control panel.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Model</th>
                  <th scope="col" className="n">Runs</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className="n" aria-sort={sort.key === c.key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
                      <button
                        className="sort"
                        onClick={() => setSort((s) => ({ key: c.key, asc: s.key === c.key ? !s.asc : true }))}
                      >
                        {c.label}
                        {sort.key === c.key ? (sort.asc ? ' ▲' : ' ▼') : ''}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="n">RMSE range</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.model === 'naive' ? 'baseline' : ''}>
                    <th scope="row">
                      <span className={`dot dot-${r.model}`} aria-hidden="true" />
                      {r.name}
                    </th>
                    <td className="n">{r.runs}</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className="n">
                        {num(r.values[c.key], c.digits)}
                      </td>
                    ))}
                    <td className="n muted">
                      {r.runs > 1 ? `${num(r.rmseRange[0], 1)} – ${num(r.rmseRange[1], 1)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Accuracy vs. compute</h2>
          <div className="controls">
            <div className="seg" role="radiogroup" aria-label="X axis">
              {X_OPTIONS.map((o) => (
                <button key={o.key} role="radio" aria-checked={xKey === o.key} className={xKey === o.key ? 'on' : ''} onClick={() => setXKey(o.key)}>
                  {o.label}
                </button>
              ))}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} />
              Log scale
            </label>
          </div>
        </div>
        <p className="muted">
          Each point is one run at {int(filters.size)} rows; the vertical axis is RMSE in kW. Points below the dashed line beat
          persistence; points further left are cheaper.
        </p>
        {scatter.length === 0 ? (
          <p className="empty">No run to plot. Select at least one model and raise the budget.</p>
        ) : (
          <Chart
            option={option}
            height={360}
            label={`Scatter plot of RMSE against ${x.label.toLowerCase()} for ${scatter.length} runs at ${filters.size} training rows`}
          />
        )}
      </section>
    </div>
  )
}
