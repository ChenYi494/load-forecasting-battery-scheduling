import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { MODEL_LABELS, type MetricKey, type ModelId, type Results, type Run } from '../data.ts'
import type { Filters } from '../filters.ts'
import { int, num, pct } from '../format.ts'
import { median } from '../stats.ts'

const METRICS: { key: MetricKey; label: string; unit: string; digits: number; log: boolean }[] = [
  { key: 'rmse', label: 'RMSE', unit: 'kW', digits: 1, log: false },
  { key: 'train_time_s', label: 'Training time', unit: 's', digits: 3, log: true },
  { key: 'rss_delta_mb', label: 'Training memory', unit: 'MB', digits: 1, log: true },
  { key: 'latency_ms_median', label: 'Latency per row', unit: 'ms', digits: 3, log: false },
]
const LEARNED: ModelId[] = ['linear', 'mlp', 'rf']

interface Cell {
  median: number | null
  min: number | null
  max: number | null
  runs: number
}

export default function DataSize({ results, filters, passing }: { results: Results; filters: Filters; passing: Run[] }) {
  const theme = useTheme()
  const [metricKey, setMetricKey] = useState<MetricKey>('rmse')
  const metric = METRICS.find((m) => m.key === metricKey)!
  const sizes = results.meta.dataset_sizes
  const models = LEARNED.filter((m) => filters.models.includes(m))
  const persistence = results.baselines.find((b) => b.lag_col === 'lag_1')!

  // Median and range per model and size, over the runs that meet the budget
  const cells = useMemo(() => {
    const out: Record<string, Cell> = {}
    for (const m of LEARNED) {
      for (const s of sizes) {
        const v = passing.filter((r) => r.model === m && r.dataset_size === s).map((r) => r[metricKey]).filter((x): x is number => x != null)
        out[`${m}-${s}`] = { median: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null, runs: v.length }
      }
    }
    return out
  }, [passing, sizes, metricKey])

  const option = useMemo<EChartsOption>(() => {
    const series: NonNullable<EChartsOption['series']> = []
    for (const m of models) {
      const c = sizes.map((s) => cells[`${m}-${s}`])
      // Range band: an invisible lower edge plus a stacked translucent band up to the max
      series.push({
        name: `${m}-min`, type: 'line', stack: m, symbol: 'none', silent: true, lineStyle: { opacity: 0 },
        data: c.map((x) => x.min), tooltip: { show: false },
      })
      series.push({
        name: `${m}-band`, type: 'line', stack: m, symbol: 'none', silent: true, lineStyle: { opacity: 0 },
        areaStyle: { color: theme.series[m], opacity: 0.14 },
        data: c.map((x) => (x.min != null && x.max != null ? x.max - x.min : null)), tooltip: { show: false },
      })
      series.push({
        name: MODEL_LABELS[m], type: 'line', symbolSize: 8, lineStyle: { width: 2.5, color: theme.series[m] },
        itemStyle: { color: theme.series[m] }, data: c.map((x) => x.median),
      })
    }
    if (metricKey === 'rmse') {
      series.push({
        name: `Persistence (${num(persistence.rmse, 1)})`, type: 'line', symbol: 'none',
        lineStyle: { type: 'dashed', color: theme.series.naive, width: 1.5 }, itemStyle: { color: theme.series.naive },
        data: sizes.map(() => persistence.rmse),
      })
    }
    return {
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 52, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted }, data: series.map((s) => String(s.name)).filter((n) => !n.includes('-')) },
      tooltip: {
        trigger: 'axis',
        formatter: (params) => {
          const list = (params as unknown as { seriesName: string; value: number | null; axisValue: string }[]).filter(
            (p) => !p.seriesName.includes('-') && p.value != null,
          )
          if (list.length === 0) return ''
          return `<b>${list[0].axisValue}</b><br/>` + list.map((p) => `${p.seriesName}: ${num(p.value, metric.digits)} ${metric.unit}`).join('<br/>')
        },
      },
      xAxis: {
        type: 'category', boundaryGap: false, data: sizes.map((s) => `${int(s)} rows`),
        axisLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.muted },
      },
      yAxis: {
        type: metric.log ? 'log' : 'value', scale: !metric.log,
        axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } },
      },
      series,
    }
  }, [models, sizes, cells, metricKey, metric, persistence.rmse, theme])

  const rf = (s: number) => cells[`rf-${s}`].median
  const lin = (s: number) => cells[`linear-${s}`].median

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <div className="panel-h">
          <h2>{metric.label} as the training set grows</h2>
          <div className="seg" role="radiogroup" aria-label="Metric">
            {METRICS.map((m) => (
              <button key={m.key} role="radio" aria-checked={metricKey === m.key} className={metricKey === m.key ? 'on' : ''} onClick={() => setMetricKey(m.key)}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <p className="muted">
          Line = median over configurations and seeds; shaded band = best to worst run ({metric.unit}
          {metric.log ? ', log scale' : ''}). Training rows are the ones right before the fixed test period, so every point is
          tested on the same {int(results.meta.test_rows)} intervals.
        </p>
        {models.length === 0 ? (
          <p className="empty">Select at least one model in the control panel.</p>
        ) : (
          <Chart option={option} height={360} label={`Line chart of median ${metric.label.toLowerCase()} by training size for ${models.map((m) => MODEL_LABELS[m]).join(', ')}`} />
        )}
      </section>

      <section className="panel span-2">
        <h2>{metric.label} by model and training size</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Model</th>
                {sizes.map((s) => (
                  <th key={s} scope="col" className="n">{int(s)} rows</th>
                ))}
                <th scope="col" className="n">Change {int(sizes[0])} → {int(sizes[sizes.length - 1])}</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const first = cells[`${m}-${sizes[0]}`].median
                const last = cells[`${m}-${sizes[sizes.length - 1]}`].median
                return (
                  <tr key={m}>
                    <th scope="row"><span className={`dot dot-${m}`} aria-hidden="true" />{MODEL_LABELS[m]}</th>
                    {sizes.map((s) => {
                      const c = cells[`${m}-${s}`]
                      return (
                        <td key={s} className="n">
                          {num(c.median, metric.digits)}
                          {c.runs > 1 && <span className="range"> ({num(c.min, metric.digits)}–{num(c.max, metric.digits)})</span>}
                        </td>
                      )
                    })}
                    <td className="n">{first && last ? pct(((last - first) / first) * 100, 0) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {metricKey === 'rmse' && rf(sizes[0]) != null && lin(sizes[0]) != null && (
          <p className="note">
            With {int(sizes[0])} and {int(sizes[1])} rows the random forest's error is {num(rf(sizes[0])! / lin(sizes[0])!, 1)}× and{' '}
            {num(rf(sizes[1])! / lin(sizes[1])!, 1)}× that of linear regression ({num(rf(sizes[0]), 1)} and {num(rf(sizes[1]), 1)} kW
            against {num(lin(sizes[0]), 1)} and {num(lin(sizes[1]), 1)} kW). Those rows cover only the winter months before the test
            period, and trees cannot predict above the highest load they were trained on. See{' '}
            <a href="#forecast">Forecasts</a>.
          </p>
        )}
      </section>
    </div>
  )
}
