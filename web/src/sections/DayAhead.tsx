import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { METHOD_LABELS, METHOD_STYLE, type Decision } from '../decision.ts'
import { num, spread } from '../format.ts'

export default function DayAhead({ decision }: { decision: Decision }) {
  const theme = useTheme()
  const rows = decision.accuracy

  const option = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 44, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 1)} kW` },
      xAxis: {
        type: 'category',
        data: rows.map((r) => METHOD_LABELS[r.method]),
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, interval: 0, width: 90, overflow: 'break' },
      },
      yAxis: { type: 'value', axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        {
          name: 'RMSE, every 15 minutes',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: theme.muted, borderRadius: [3, 3, 0, 0] },
          data: rows.map((r) => ({ value: r.rmse.mean, itemStyle: { color: theme.series[METHOD_STYLE[r.method].color] } })),
        },
        {
          name: 'Error of the daily maximum',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: theme.line, borderRadius: [3, 3, 0, 0] },
          data: rows.map((r) => r.peak_mae.mean),
        },
      ],
    }),
    [theme, rows],
  )

  return (
    <div className="panel-grid">

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Accuracy over the test period</h2>
          <span className="muted">kW; mean over seeds (range)</span>
        </div>
        <Chart option={option} height={300} label="Bar chart of RMSE and daily-maximum error for each day-ahead method" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col" className="n">RMSE</th>
                <th scope="col" className="n">MAE</th>
                <th scope="col" className="n">Daily max error</th>
                <th scope="col" className="n">Days with max under-forecast</th>
                <th scope="col" className="n">Training (s)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.method}>
                  <th scope="row">
                    <span className={`dot dot-${METHOD_STYLE[r.method].color}`} aria-hidden="true" />
                    {METHOD_LABELS[r.method]}
                  </th>
                  <td className="n">{spread(r.rmse, r.seeds)}</td>
                  <td className="n">{spread(r.mae, r.seeds)}</td>
                  <td className="n">{spread(r.peak_mae, r.seeds)}</td>
                  <td className="n">{num(r.peak_under_share.mean * 100, 0)}%</td>
                  <td className="n">{num(r.train_time_s.mean, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
