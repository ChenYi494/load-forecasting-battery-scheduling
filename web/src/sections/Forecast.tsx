import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import type { Results } from '../data.ts'
import { day, int, num } from '../format.ts'
import { rmse } from '../stats.ts'

// Series in results.forecast_week and the model color each one uses
const SERIES: { key: string; color: 'naive' | 'linear' | 'mlp' | 'rf'; dashed?: boolean }[] = [
  { key: 'persistence', color: 'naive', dashed: true },
  { key: 'linear_100k', color: 'linear' },
  { key: 'mlp_100k', color: 'mlp' },
  { key: 'rf_10k', color: 'rf', dashed: true },
  { key: 'rf_100k', color: 'rf' },
]

export default function Forecast({ results }: { results: Results }) {
  const theme = useTheme()
  const week = results.forecast_week
  const [shown, setShown] = useState<string[]>(['mlp_100k', 'rf_10k'])
  const rf10k = results.findings.extrapolation.find((e) => e.key === 'rf_10k')

  const weekRmse = useMemo(
    () => Object.fromEntries(SERIES.map((s) => [s.key, rmse(week.actual, week.series[s.key])])),
    [week],
  )

  const option = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 52, right: 16, top: 44, bottom: 72 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 0)} kW` },
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 22, bottom: 12, borderColor: theme.line, textStyle: { color: theme.muted } },
      ],
      xAxis: {
        type: 'category',
        data: week.timestamps,
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, formatter: (v: string) => v.slice(5, 16).replace(' ', '\n') },
      },
      yAxis: { type: 'value', scale: true, axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        {
          name: 'Actual load',
          type: 'line',
          symbol: 'none',
          lineStyle: { color: theme.series.actual, width: 1.6 },
          itemStyle: { color: theme.series.actual },
          data: week.actual,
          markLine: rf10k
            ? {
                symbol: 'none',
                silent: true,
                lineStyle: { color: theme.series.rf, type: 'dotted', width: 1.5 },
                label: { formatter: `Highest load in the 10k training rows (${num(rf10k.train_max_kw, 0)} kW)`, color: theme.muted, position: 'insideMiddleBottom' },
                data: [{ yAxis: rf10k.train_max_kw }],
              }
            : undefined,
        },
        ...SERIES.filter((s) => shown.includes(s.key)).map((s) => ({
          name: week.labels[s.key],
          type: 'line' as const,
          symbol: 'none',
          lineStyle: { color: theme.series[s.color], width: 1.6, type: s.dashed ? ('dashed' as const) : ('solid' as const) },
          itemStyle: { color: theme.series[s.color] },
          data: week.series[s.key],
        })),
      ],
    }),
    [theme, week, shown, rf10k],
  )

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <div className="panel-h">
          <h2>One test week around the highest load</h2>
          <span className="muted">
            {day(week.start)} – {day(week.end)} · kW · drag the slider or scroll to zoom
          </span>
        </div>
        <fieldset className="series-picker">
          <legend className="visually-hidden">Forecasts to show</legend>
          {SERIES.map((s) => (
            <label key={s.key} className="check-row">
              <input
                type="checkbox"
                checked={shown.includes(s.key)}
                onChange={(e) => setShown(e.target.checked ? [...shown, s.key] : shown.filter((k) => k !== s.key))}
              />
              <span className={`dot dot-${s.color}`} aria-hidden="true" />
              {week.labels[s.key]}
            </label>
          ))}
        </fieldset>
        <Chart option={option} height={420} label={`Line chart of actual load and selected forecasts from ${day(week.start)} to ${day(week.end)}`} />
        <p className="muted">
          Models were re-trained once with seed 42 to draw these curves; their errors over the whole test period match the
          benchmark runs.
        </p>
      </section>

      <section className="panel span-2">
        <h2>Error in this week</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecast</th>
                <th scope="col" className="n">RMSE (kW)</th>
                <th scope="col" className="n">Highest forecast (kW)</th>
              </tr>
            </thead>
            <tbody>
              {SERIES.map((s) => (
                <tr key={s.key}>
                  <th scope="row"><span className={`dot dot-${s.color}`} aria-hidden="true" />{week.labels[s.key]}</th>
                  <td className="n">{num(weekRmse[s.key], 1)}</td>
                  <td className="n">{num(Math.max(...week.series[s.key]), 0)}</td>
                </tr>
              ))}
              <tr className="baseline">
                <th scope="row">Actual load</th>
                <td className="n">—</td>
                <td className="n">{num(Math.max(...week.actual), 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel span-2">
        <h2>Why the small random forest fails</h2>
        <p>
          A random forest predicts averages of training values, so it can never forecast above the highest load it has seen.
          Over the whole test period:
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Model</th>
                <th scope="col" className="n">Training max (kW)</th>
                <th scope="col" className="n">Test rows above it</th>
                <th scope="col" className="n">RMSE there</th>
                <th scope="col" className="n">RMSE elsewhere</th>
              </tr>
            </thead>
            <tbody>
              {results.findings.extrapolation.map((e) => (
                <tr key={e.key}>
                  <th scope="row">{e.label}</th>
                  <td className="n">{num(e.train_max_kw, 0)}</td>
                  <td className="n">{num(e.share_test_above_train_max * 100, 1)}%</td>
                  <td className="n">{num(e.rmse_rows_above, 0)}</td>
                  <td className="n">{num(e.rmse_rows_within, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rf10k && (
          <p className="note">
            With {int(10000)} training rows, {num(rf10k.share_test_above_train_max * 100, 1)}% of test intervals exceed the training
            maximum; the forest's error there is {num(rf10k.rmse_rows_above, 0)} kW. Linear regression and the MLP extrapolate
            through the lag features and are not capped.
          </p>
        )}
      </section>
    </div>
  )
}
