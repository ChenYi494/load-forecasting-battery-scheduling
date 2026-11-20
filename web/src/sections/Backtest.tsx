import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { METHOD_LABELS, METHOD_STYLE, METHODS, type Decision, type MethodId } from '../decision.ts'
import { int, num, spread } from '../format.ts'

const twd = (v: number) => `NT$${int(Math.round(v))}`
const signedTwd = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}NT$${int(Math.round(Math.abs(v)))}`

export default function Backtest({ decision }: { decision: Decision }) {
  const theme = useTheme()
  const bt = decision.backtest
  const { battery, tariff } = decision.meta
  const plain = (m: string) => bt.methods.find((r) => r.method === m)!
  const flat = (m: string) => bt.flatten.find((r) => r.method === m)!
  const perfect = plain('perfect_foresight')
  const range = (values: number[]) => `${num(Math.min(...values), 1)}–${num(Math.max(...values), 1)}%`
  const plainShares = useMemo(() => METHODS.map((m) => bt.methods.find((r) => r.method === m)!.share_of_perfect.mean), [bt])
  const flatShares = useMemo(() => METHODS.map((m) => bt.flatten.find((r) => r.method === m)!.share_of_plain_perfect.mean), [bt])
  const quantiles = [...new Set(bt.margin.map((r) => r.quantile))].sort((a, b) => a - b)
  const sensCols = [...new Set(bt.sensitivity.map((r) => `${r.battery_hours}|${r.tariff_shift_h}`))]

  const shareOption = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 44, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 1)}%` },
      xAxis: {
        type: 'category',
        data: METHODS.map((m) => METHOD_LABELS[m]),
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, interval: 0, width: 90, overflow: 'break' },
      },
      yAxis: { type: 'value', min: 70, max: 100, axisLabel: { color: theme.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        {
          name: 'Plain plan',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: theme.line, borderRadius: [3, 3, 0, 0] },
          data: plainShares,
        },
        {
          name: 'Discharge at highest forecast load',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: theme.muted, borderRadius: [3, 3, 0, 0] },
          data: METHODS.map((m, i) => ({ value: flatShares[i], itemStyle: { color: theme.series[METHOD_STYLE[m].color] } })),
        },
      ],
    }),
    [theme, plainShares, flatShares],
  )

  const monthOption = useMemo<EChartsOption>(() => {
    const months = [...new Set(bt.monthly.map((r) => r.month))]
    return {
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 64, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => twd(Number(v)) },
      xAxis: { type: 'category', data: months, axisLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.muted } },
      yAxis: { type: 'value', axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
      series: (['perfect_foresight', ...METHODS] as const).map((m) => ({
        name: METHOD_LABELS[m],
        type: 'line' as const,
        symbolSize: 5,
        lineStyle: { color: theme.series[METHOD_STYLE[m].color], width: 1.6, type: METHOD_STYLE[m].dashed ? ('dashed' as const) : ('solid' as const) },
        itemStyle: { color: theme.series[METHOD_STYLE[m].color] },
        data: months.map((mo) => bt.monthly.find((r) => r.month === mo && r.method === m)?.excess ?? null),
      })),
    }
  }, [theme, bt])

  return (
    <div className="panel-grid">
      <div className="tiles span-2">
        <div className="tile t1">
          <span className="tile-k">Bill without a battery</span>
          <span className="tile-v num">{twd(bt.no_battery_total)}</span>
          <span className="tile-n">{decision.meta.test_days} days · contract {num(bt.contract_no_battery_kw, 0)} kW</span>
        </div>
        <div className="tile t2">
          <span className="tile-k">Saving with perfect foresight</span>
          <span className="tile-v num">{twd(perfect.saving.mean)}</span>
          <span className="tile-n">
            {num(perfect.saving_pct.mean, 1)}% · contract {num(bt.contract_battery_kw, 0)} kW
          </span>
        </div>
        <div className="tile t3">
          <span className="tile-k">Forecast plans, plain</span>
          <span className="tile-v num">{range(plainShares)}</span>
          <span className="tile-n">of the perfect-foresight saving</span>
        </div>
        <div className="tile t4">
          <span className="tile-k">Discharge at highest load</span>
          <span className="tile-v num">{range(flatShares)}</span>
          <span className="tile-n">same forecasts, one planner change</span>
        </div>
      </div>

      <section className="panel span-2">
        <h2>How it is scored</h2>
        <p className="lead">
          Every test day, each forecast plans tomorrow's battery schedule with dynamic programming; the plan is then run against the
          actual load and billed with the Taipower high-voltage two-stage tariff. Perfect foresight plans on the actual load and is the
          upper bound. Score: share of the perfect-foresight saving that a forecast keeps.
        </p>
        <dl className="facts">
          <dt>Battery</dt>
          <dd>
            {int(battery.capacity_kwh)} kWh, {int(battery.power_kw)} kW, {num(battery.round_trip_efficiency * 100, 0)}% round trip (an
            assumption: {battery.hours} h of mean load)
          </dd>
          <dt>Contract</dt>
          <dd>chosen once from the last 12 months of training data, before the test period</dd>
          <dt>Planner check</dt>
          <dd>dynamic programming agrees with an exact linear program (HiGHS) to within 0.15% on real test days</dd>
        </dl>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Share of the perfect-foresight saving</h2>
          <span className="muted">mean over seeds</span>
        </div>
        <Chart option={shareOption} height={300} label="Bar chart of the share of the perfect-foresight saving for each forecast, plain plan and discharge-at-highest-load plan" />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecast</th>
                <th scope="col" className="n">Plain plan</th>
                <th scope="col" className="n">Excess charge</th>
                <th scope="col" className="n">Discharge at highest load</th>
                <th scope="col" className="n">Excess charge</th>
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m) => (
                <tr key={m}>
                  <th scope="row">
                    <span className={`dot dot-${METHOD_STYLE[m].color}`} aria-hidden="true" />
                    {METHOD_LABELS[m]}
                  </th>
                  <td className="n">{spread(plain(m).share_of_perfect, plain(m).seeds, 1, '%')}</td>
                  <td className="n">{twd(plain(m).excess.mean)}</td>
                  <td className="n">{spread(flat(m).share_of_plain_perfect, flat(m).seeds, 1, '%')}</td>
                  <td className="n">{twd(flat(m).excess.mean)}</td>
                </tr>
              ))}
              <tr className="baseline">
                <th scope="row">Perfect foresight</th>
                <td className="n">100%</td>
                <td className="n">{twd(perfect.excess.mean)}</td>
                <td className="n">{num(flat('perfect_foresight').share_of_plain_perfect.mean, 1)}%</td>
                <td className="n">{twd(flat('perfect_foresight').excess.mean)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note">
          On this client, with the plain plan every forecast keeps about the same share, and the range across seeds of one model is as
          wide as the gap between models. Changing where the planner discharges inside a price period moves every forecast up by about
          ten points; which forecast is used moves it by a few. The Ten clients tab repeats this on nine more clients.
        </p>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Where the saving comes from (plain plan)</h2>
          <span className="muted">change against no battery; negative = cheaper</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Strategy</th>
                <th scope="col" className="n">Energy charge</th>
                <th scope="col" className="n">Basic charge</th>
                <th scope="col" className="n">Excess charge</th>
                <th scope="col" className="n">Months with excess</th>
              </tr>
            </thead>
            <tbody>
              {(['perfect_foresight', ...METHODS] as const).map((m) => (
                <tr key={m}>
                  <th scope="row">
                    <span className={`dot dot-${METHOD_STYLE[m].color === 'perfect' ? 'naive' : METHOD_STYLE[m].color}`} aria-hidden="true" />
                    {METHOD_LABELS[m]}
                  </th>
                  <td className="n">{signedTwd(plain(m).energy_delta.mean)}</td>
                  <td className="n">{signedTwd(plain(m).basic_delta.mean)}</td>
                  <td className="n">{signedTwd(plain(m).excess_delta.mean)}</td>
                  <td className="n">{num(plain(m).months_with_excess.mean, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          Most of the saving is buying at the off-peak price and using it at the peak price, which needs no forecast. Forecast errors
          show up almost only as excess-demand charges: the plan expects to stay under the contract and the real load does not.
        </p>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Excess charge per month (plain plan)</h2>
          <span className="muted">TWD; mean over seeds</span>
        </div>
        <Chart option={monthOption} height={300} label="Line chart of the monthly excess-demand charge for each strategy" />
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>A safety margin does not fix it</h2>
          <span className="muted">plain plan; forecast + a quantile of its own past error</span>
        </div>
        <p>
          The margin is a quantile of each forecast's under-forecast error on the 90 days before the test period, so it is fixed without
          looking at the test data.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecast</th>
                {quantiles.map((q) => (
                  <th key={q} scope="col" className="n">
                    {q === 0 ? 'No margin' : `${num(q * 100, 0)}th pct.`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m: MethodId) => (
                <tr key={m}>
                  <th scope="row">{METHOD_LABELS[m]}</th>
                  {quantiles.map((q) => {
                    const r = bt.margin.find((x) => x.method === m && x.quantile === q)!
                    return (
                      <td key={q} className="n">
                        {num(r.share_of_perfect.mean, 1)}%{q > 0 && <span className="range"> · +{num(r.margin_kw.mean, 0)} kW</span>}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          A larger margin lowers the excess charge but keeps the battery from buying cheap and selling dear, so the two nearly cancel.
          The overrun that sets a month's charge is often larger than any margin taken from typical errors.
        </p>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>Sensitivity (plain plan)</h2>
          <span className="muted">share of the perfect-foresight saving; battery size and tariff periods moved earlier/later</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Forecast</th>
                {sensCols.map((c) => {
                  const [h, s] = c.split('|').map(Number)
                  return (
                    <th key={c} scope="col" className="n">
                      {h} h{s !== 0 ? `, periods ${s > 0 ? '+' : '−'}${Math.abs(s)} h` : ''}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {METHODS.map((m) => (
                <tr key={m}>
                  <th scope="row">{METHOD_LABELS[m]}</th>
                  {sensCols.map((c) => {
                    const [h, s] = c.split('|').map(Number)
                    const r = bt.sensitivity.find((x) => x.method === m && x.battery_hours === h && x.tariff_shift_h === s)
                    return (
                      <td key={c} className="n">
                        {r ? `${num(r.share_of_perfect.mean, 1)}%` : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
              <tr className="baseline">
                <th scope="row">Perfect-foresight saving</th>
                {sensCols.map((c) => {
                  const [h, s] = c.split('|').map(Number)
                  const r = bt.sensitivity.find((x) => x.method === 'perfect_foresight' && x.battery_hours === h && x.tariff_shift_h === s)
                  return (
                    <td key={c} className="n">
                      {r ? twd(r.saving.mean) : '—'}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel span-2">
        <h2>Tariff and limits</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col" className="n">Summer ({tariff.summer})</th>
                <th scope="col" className="n">Rest of the year</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Basic charge, TWD per kW per month</th>
                <td className="n">{num(tariff.basic_per_kw_month.summer, 2)}</td>
                <td className="n">{num(tariff.basic_per_kw_month.non_summer, 2)}</td>
              </tr>
              {(['peak', 'semi_peak', 'off_peak'] as const).map((p) => (
                <tr key={p}>
                  <th scope="row">{{ peak: 'Peak', semi_peak: 'Saturday semi-peak', off_peak: 'Off-peak' }[p]}, TWD per kWh</th>
                  <td className="n">{num(tariff.energy_per_kwh.summer[p], 2)}</td>
                  <td className="n">{num(tariff.energy_per_kwh.non_summer[p], 2)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Weekday peak hours</th>
                <td className="n">{tariff.periods.summer.weekday.map((s) => s.split(' ')[0]).join(', ')}</td>
                <td className="n">{tariff.periods.non_summer.weekday.map((s) => s.split(' ')[0]).join(', ')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Excess demand above the contract: up to 10% of the contract at {tariff.excess_multiples[0]}× the basic charge, the rest at{' '}
          {tariff.excess_multiples[1]}×. Source: {tariff.source.document} (retrieved {tariff.source.retrieved}).
        </p>
        <ul className="findings">
          <li>The tariff is Taiwanese and the load is Portuguese: this is an illustrative price structure, not a real bill. Results depend on it; heavy excess charges are what make forecast errors costly here.</li>
          <li>Taiwanese public holidays (all-day off-peak) are not applied; only Sundays are all-day off-peak.</li>
          <li>One test year. Everything on this page is MT_200; the ten-client check repeats only the base case. The battery size and efficiency are assumptions.</li>
          <li>The planner works one day at a time and does not know the month's highest demand so far.</li>
        </ul>
      </section>
    </div>
  )
}
