import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { METHOD_LABELS, METHOD_STYLE, METHODS, type MultiClient } from '../decision.ts'
import { int, num } from '../format.ts'

const mean = (values: number[]) => values.reduce((a, v) => a + v, 0) / values.length
const range = (values: number[]) => `${num(Math.min(...values), 1)}–${num(Math.max(...values), 1)}`

export default function Clients({ mc }: { mc: MultiClient }) {
  const theme = useTheme()
  const s = mc.summary
  const n = mc.clients.length

  const option = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 44, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 1)}%` },
      xAxis: { type: 'category', data: mc.clients.map((c) => c.client), axisLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.muted } },
      yAxis: { type: 'value', min: 0, max: 100, axisLabel: { color: theme.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        {
          name: 'Plain plan (mean of 5 forecasts)',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: theme.line, borderRadius: [3, 3, 0, 0] },
          data: mc.clients.map((c) => mean(METHODS.map((m) => c.plain.share[m]))),
        },
        {
          name: 'Discharge at highest load (mean of 5 forecasts)',
          type: 'bar',
          barMaxWidth: 22,
          itemStyle: { color: theme.series.perfect, borderRadius: [3, 3, 0, 0] },
          data: mc.clients.map((c) => mean(METHODS.map((m) => c.flatten.share[m]))),
        },
      ],
    }),
    [theme, mc],
  )

  return (
    <div className="panel-grid">
      <div className="tiles span-2">
        <div className="tile t1">
          <span className="tile-k">Planner change helps every forecast</span>
          <span className="tile-v num">
            {s.flatten_helps_all_methods} / {n}
          </span>
          <span className="tile-n">clients</span>
        </div>
        <div className="tile t2">
          <span className="tile-k">Gain from the planner change</span>
          <span className="tile-v num">+{num(s.flatten_gain_mean, 1)} pts</span>
          <span className="tile-n">
            mean; {num(s.flatten_gain_min, 1)} to {num(s.flatten_gain_max, 1)} across clients
          </span>
        </div>
        <div className="tile t3">
          <span className="tile-k">Gap between forecasts</span>
          <span className="tile-v num">{num(s.flatten_median_model_gap, 1)} pts</span>
          <span className="tile-n">median, best minus worst forecast</span>
        </div>
        <div className="tile t4">
          <span className="tile-k">RMSE order vs. bill order</span>
          <span className="tile-v num">
            {num(s.plain_median_rank_corr_rmse, 2)} → {num(s.flatten_median_rank_corr_rmse, 2)}
          </span>
          <span className="tile-n">median Spearman, plain → improved planner</span>
        </div>
      </div>

      <section className="panel span-2">
        <h2>Does it hold beyond MT_200?</h2>
        <p className="lead">
          The base case (2 h battery, unshifted tariff, 3 seeds for MLP and random forest) was repeated on ten clients with the same
          code. Each client gets its own battery size, contract and training data.
        </p>
        <dl className="facts">
          <dt>Selection</dt>
          <dd>
            {mc.eligible} of {mc.clients_total} clients have data on at least {num((1 - mc.rule.max_zero_day_share) * 100, 0)}% of days
            from {mc.rule.window[0].slice(0, 4)} to {mc.rule.window[1].slice(0, 4)} and a mean load of at least{' '}
            {int(mc.rule.min_mean_kw)} kW (the smallest contract on the high-voltage tariff). MT_200 plus {n - 1} of them drawn at
            random (seed {mc.rule.seed}), so none are hand-picked.
          </dd>
          <dt>Score</dt>
          <dd>share of each client's own perfect-foresight saving, for the plain plan and the discharge-at-highest-load plan</dd>
        </dl>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Share of the perfect-foresight saving by client</h2>
          <span className="muted">mean of the 5 forecasts</span>
        </div>
        <Chart option={option} height={300} label="Bar chart of the share of the perfect-foresight saving for each of ten clients, plain plan and improved plan" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col" className="n">Mean load (kW)</th>
                <th scope="col" className="n">Perfect saving</th>
                <th scope="col" className="n">Plain plan</th>
                <th scope="col" className="n">Highest-load plan</th>
                <th scope="col" className="n">Gap between forecasts</th>
                <th scope="col" className="n">Spread across seeds</th>
                <th scope="col">Cheapest forecast</th>
                <th scope="col">Lowest RMSE</th>
              </tr>
            </thead>
            <tbody>
              {mc.clients.map((c) => (
                <tr key={c.client}>
                  <th scope="row">{c.client}</th>
                  <td className="n">{int(Math.round(c.mean_load_kw))}</td>
                  <td className="n">{num(c.perfect_saving_pct, 1)}%</td>
                  <td className="n">{range(METHODS.map((m) => c.plain.share[m]))}%</td>
                  <td className="n">{range(METHODS.map((m) => c.flatten.share[m]))}%</td>
                  <td className="n">{num(c.flatten.model_gap, 1)}</td>
                  <td className="n">{num(c.flatten.seed_spread, 1)}</td>
                  <td>{METHOD_LABELS[c.flatten.best]}</td>
                  <td>{METHOD_LABELS[c.best_rmse]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          Gap and spread are in percentage points for the highest-load plan; the spread is the widest range across the three seeds of one
          model. Ranges in the plan columns run from the worst to the best of the five forecasts.
        </p>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Mean over the ten clients</h2>
          <span className="muted">share of the perfect-foresight saving</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecast</th>
                <th scope="col" className="n">Plain plan</th>
                <th scope="col" className="n">Highest-load plan</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m) => (
                <tr key={m}>
                  <th scope="row">
                    <span className={`dot dot-${METHOD_STYLE[m].color}`} aria-hidden="true" />
                    {METHOD_LABELS[m]}
                  </th>
                  <td className="n">{num(s.plain_mean_share[m], 1)}%</td>
                  <td className="n">{num(s.flatten_mean_share[m], 1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="findings">
          <li>
            <b>The planner matters most, on every client.</b> Discharging at the highest forecast load raises every forecast's share on{' '}
            {s.flatten_helps_all_methods} of {n} clients, by {num(s.flatten_gain_mean, 1)} points on average.
          </li>
          <li>
            <b>A weak planner hides forecast quality.</b> With the plain plan, the gap between forecasts exceeds the spread across seeds on
            only {s.plain_gap_above_seed_spread} of {n} clients, and RMSE barely predicts the bill (median Spearman{' '}
            {num(s.plain_median_rank_corr_rmse, 2)}). With the improved planner the gap exceeds the seed spread on{' '}
            {s.flatten_gap_above_seed_spread} of {n} clients and the correlation rises to {num(s.flatten_median_rank_corr_rmse, 2)}.
          </li>
          <li>
            <b>Better forecasts then help, but a little.</b> A learned model beats both naive forecasts on {s.flatten_learned_beats_naive}{' '}
            of {n} clients; the median gap between the best and worst forecast is {num(s.flatten_median_model_gap, 1)} points.
          </li>
          <li>
            <b>The error of the daily maximum does not rank the bills</b> (median Spearman {num(s.plain_median_rank_corr_peak, 2)} plain,{' '}
            {num(s.flatten_median_rank_corr_peak, 2)} improved). On MT_200 the learned models under-forecast the daily peak most often,
            but that is not a general explanation.
          </li>
          <li>
            <b>One client is not enough to rank models.</b> MT_200 rerun with this pipeline (contract chosen on a finer grid; the
            multi-client ETL keeps 21 intervals the main ETL drops) moves the MLP's plain-plan share by about 5 points.
          </li>
        </ul>
      </section>
    </div>
  )
}
