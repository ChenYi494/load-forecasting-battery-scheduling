import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { MODEL_LABELS, type ModelId, type Results } from '../data.ts'
import { day, int, num, pct } from '../format.ts'

const LEARNED: ModelId[] = ['linear', 'mlp', 'rf']


export default function Overview({ results }: { results: Results }) {
  const theme = useTheme()
  const { findings, meta, groups } = results
  const persistence = results.baselines.find((b) => b.lag_col === 'lag_1')!
  const seasonal = results.baselines.find((b) => b.lag_col === 'lag_96')!
  const median = (model: ModelId, size: number, key: 'rmse' | 'rss_delta_mb') =>
    groups.find((g) => g.model === model && g.dataset_size === size)?.[key].median ?? null
  const rf10k = findings.extrapolation.find((e) => e.key === 'rf_10k')
  const largest = meta.dataset_sizes[meta.dataset_sizes.length - 1]
  const smallSize = meta.dataset_sizes[1] ?? meta.dataset_sizes[0]

  const option = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 44, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 1)} kW` },
      xAxis: {
        type: 'category',
        data: meta.dataset_sizes.map((s) => `${int(s)} rows`),
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted },
      },
      series: [
        ...LEARNED.map((m) => ({
          name: MODEL_LABELS[m],
          type: 'bar' as const,
          barMaxWidth: 28,
          itemStyle: { color: theme.series[m], borderRadius: [3, 3, 0, 0] },
          data: meta.dataset_sizes.map((s) => median(m, s, 'rmse')),
        })),
        {
          name: `Persistence (${num(persistence.rmse, 1)})`,
          type: 'line' as const,
          symbol: 'none',
          lineStyle: { color: theme.series.naive, type: 'dashed', width: 1.5 },
          itemStyle: { color: theme.series.naive },
          data: meta.dataset_sizes.map(() => persistence.rmse),
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme, results],
  )

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <h2>The question</h2>
        <p className="lead">
          Forecasting the next 15 minutes of electricity load, how much do linear regression, an MLP and a random forest
          improve on simply repeating the last value, and what do they cost to train and run?
        </p>
        <ul className="findings">
          <li>
            <b>The best model beats persistence by {pct(-findings.best_run.vs_persistence_pct).replace('+', '')}.</b>{' '}
            {MODEL_LABELS[findings.best_run.model]} with {int(findings.best_run.dataset_size)} training rows reaches{' '}
            {num(findings.best_run.rmse, 1)} kW RMSE against {num(persistence.rmse, 1)} kW for persistence. Repeating the
            value from 24 hours earlier is much worse ({num(seasonal.rmse, 1)} kW).
          </li>
          {rf10k && (
            <li>
              <b>Random forests fail when the test period goes beyond the training range.</b> Trained on {int(smallSize)}{' '}
              winter rows, {num(rf10k.share_test_above_train_max * 100, 1)}% of test loads exceed the highest load it has
              seen ({num(rf10k.train_max_kw, 0)} kW); its error there is {num(rf10k.rmse_rows_above, 0)} kW against{' '}
              {num(rf10k.rmse_rows_within, 0)} kW elsewhere. Median RMSE at {int(smallSize)} rows: random forest{' '}
              {num(median('rf', smallSize, 'rmse'), 1)}, linear regression {num(median('linear', smallSize, 'rmse'), 1)}.
            </li>
          )}
          <li>
            <b>Accuracy gains cost memory.</b> At {int(largest)} rows the random forest needs a median{' '}
            {num(median('rf', largest, 'rss_delta_mb'), 0)} MB to train, linear regression{' '}
            {num(median('linear', largest, 'rss_delta_mb'), 1)} MB.
          </li>
        </ul>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Median RMSE by model and training size</h2>
          <span className="muted">kW, lower is better · dashed line = persistence</span>
        </div>
        <Chart
          option={option}
          height={300}
          label={`Bar chart of median RMSE for linear regression, MLP and random forest at ${meta.dataset_sizes.join(', ')} training rows, with persistence at ${num(persistence.rmse, 1)} kW`}
        />
      </section>

      <section className="panel">
        <h2>Setup</h2>
        <dl className="facts">
          <dt>Data</dt>
          <dd>
            <a href={meta.dataset_url}>{meta.dataset}</a>, client {meta.client}, {int(meta.rows)} rows of{' '}
            {meta.interval_minutes}-minute load ({meta.unit})
          </dd>
          <dt>Target</dt>
          <dd>{meta.target}</dd>
          <dt>Features</dt>
          <dd>{meta.features.join(', ')}</dd>
          <dt>Test period</dt>
          <dd>
            {day(meta.test_start)} – {day(meta.test_end)}, {int(meta.test_rows)} intervals, the same for every run
          </dd>
          <dt>Training sizes</dt>
          <dd>{meta.dataset_sizes.map(int).join(' / ')} rows right before the test period</dd>
        </dl>
      </section>

      <section className="panel">
        <h2>Measurement</h2>
        <dl className="facts">
          <dt>Hardware</dt>
          <dd>
            {String(meta.hardware.cpu)}, {String(meta.hardware.ram_gb)} GB, Python {String(meta.hardware.python)}
          </dd>
          {Object.entries(meta.protocol).map(([k, v]) => (
            <div key={k} className="fact">
              <dt>{k[0].toUpperCase() + k.slice(1)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <dt>Runs</dt>
          <dd>{meta.runs} (3 seeds per configuration; baselines once per size)</dd>
        </dl>
      </section>
    </div>
  )
}
