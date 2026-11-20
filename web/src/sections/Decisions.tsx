import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { useTheme } from '../components/useTheme.ts'
import { METHOD_LABELS, METHOD_STYLE, type Decision, type Planner, type StrategyId } from '../decision.ts'
import { day, num } from '../format.ts'

// Strategy shown on the chart -> key of its forecast and plan in decision.json (seed 42 for learned models)
const PLANS: { id: StrategyId; key: string }[] = [
  { id: 'perfect_foresight', key: 'perfect_foresight' },
  { id: 'naive_yesterday', key: 'naive_yesterday' },
  { id: 'linear', key: 'linear_s42' },
  { id: 'mlp', key: 'mlp_s42' },
  { id: 'rf', key: 'rf_s42' },
]
const PLANNERS: { id: Planner; label: string }[] = [
  { id: 'plain', label: 'Plain plan' },
  { id: 'flatten', label: 'Discharge at highest load' },
]
const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)
const PERIOD_LABEL = { peak: 'peak', semi_peak: 'Saturday semi-peak', off_peak: 'off-peak' } as const

/** Contiguous runs of the same tariff period, as [start, end) slot indexes */
function periodBlocks(period: string[]) {
  const blocks: { from: number; to: number; period: string }[] = []
  period.forEach((p, i) => {
    const last = blocks[blocks.length - 1]
    if (last && last.period === p) last.to = i + 1
    else blocks.push({ from: i, to: i + 1, period: p })
  })
  return blocks
}

export default function Decisions({ decision }: { decision: Decision }) {
  const theme = useTheme()
  const contract = decision.backtest.contract_battery_kw
  const [dayIndex, setDayIndex] = useState(0)
  const [strategy, setStrategy] = useState<StrategyId>('mlp')
  const [planner, setPlanner] = useState<Planner>('plain')
  const d = decision.days[dayIndex]
  const plan = PLANS.find((p) => p.id === strategy)!
  const schedule = d.plans[`${plan.key}|${planner}`]
  const forecast = strategy === 'perfect_foresight' ? null : d.forecasts[plan.key]
  const color = theme.series[METHOD_STYLE[strategy].color]
  const weekday = new Date(d.day).toLocaleDateString('en-GB', { weekday: 'long' })

  const maxGrid = Math.max(...schedule.grid)
  const maxActual = Math.max(...d.actual)
  const maxForecast = forecast ? Math.max(...forecast) : null
  const overSlots = schedule.grid.filter((g) => g > contract + 1e-6).length

  const loadOption = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 52, right: 16, top: 44, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 0)} kW` },
      xAxis: {
        type: 'category',
        data: TIMES,
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, interval: 11 },
      },
      yAxis: { type: 'value', scale: true, axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        {
          name: 'Actual load',
          type: 'line',
          symbol: 'none',
          lineStyle: { color: theme.series.actual, width: 1.4 },
          itemStyle: { color: theme.series.actual },
          data: d.actual,
          markArea: {
            silent: true,
            itemStyle: { color: 'rgba(196, 106, 18, 0.08)' },
            data: periodBlocks(d.period)
              .filter((b) => b.period !== 'off_peak')
              .map((b) => [{ xAxis: TIMES[b.from] }, { xAxis: TIMES[Math.min(b.to, 95)] }]),
          },
          markLine: {
            symbol: 'none',
            silent: true,
            lineStyle: { color: theme.muted, type: 'dashed', width: 1.2 },
            label: { formatter: `contract ${num(contract, 0)} kW`, color: theme.muted, position: 'insideEndTop' },
            data: [{ yAxis: contract }],
          },
        },
        ...(forecast
          ? [
              {
                name: 'Forecast used to plan',
                type: 'line' as const,
                symbol: 'none',
                lineStyle: { color, width: 1.4, type: 'dotted' as const },
                itemStyle: { color },
                data: forecast,
              },
            ]
          : []),
        {
          name: 'Drawn from the grid',
          type: 'line',
          symbol: 'none',
          lineStyle: { color, width: 2 },
          itemStyle: { color },
          data: schedule.grid,
        },
      ],
    }),
    [theme, d, forecast, schedule, color, contract],
  )

  const batteryOption = useMemo<EChartsOption>(
    () => ({
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 52, right: 16, top: 30, bottom: 36 },
      legend: { top: 0, textStyle: { color: theme.muted } },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Math.abs(Number(v)), 0)} kW` },
      xAxis: {
        type: 'category',
        data: TIMES,
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, interval: 11 },
      },
      yAxis: { type: 'value', axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        { name: 'Charging', type: 'bar', stack: 'b', itemStyle: { color: theme.series.linear }, data: schedule.charge },
        { name: 'Discharging', type: 'bar', stack: 'b', itemStyle: { color: theme.series.mlp }, data: schedule.discharge.map((v) => -v) },
      ],
    }),
    [theme, schedule],
  )

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <h2>What the battery did on the worst day of each month</h2>
        <p className="lead">
          Each day the battery plan is made from the forecast, then run against the actual load: any load the forecast missed
          comes from the grid. These are the days on which the plain MLP plan (seed 42) drew the most above the contract in each
          month; the monthly excess charge is set by such a day.
        </p>
        <div className="controls">
          <label className="field-inline">
            <span>Day</span>
            <select value={dayIndex} onChange={(e) => setDayIndex(Number(e.target.value))}>
              {decision.days.map((x, i) => (
                <option key={x.day} value={i}>
                  {day(x.day)} · {x.worst_over_kw > 0 ? `+${num(x.worst_over_kw, 0)}` : num(x.worst_over_kw, 0)} kW at {x.worst_at}
                </option>
              ))}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Forecast used to plan">
            {PLANS.map((p) => (
              <button key={p.id} type="button" className={strategy === p.id ? 'on' : ''} aria-pressed={strategy === p.id} onClick={() => setStrategy(p.id)}>
                {METHOD_LABELS[p.id]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Planner">
            {PLANNERS.map((p) => (
              <button key={p.id} type="button" className={planner === p.id ? 'on' : ''} aria-pressed={planner === p.id} onClick={() => setPlanner(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="panel span-2">
        <div className="panel-h">
          <h2>
            {weekday}, {day(d.day)}
          </h2>
          <span className="muted">kW · shaded: {d.period.includes('peak') ? 'peak' : 'Saturday semi-peak'} price period</span>
        </div>
        <Chart option={loadOption} height={360} label={`Actual load, forecast and grid draw on ${d.day} with the contract line`} />
        <Chart option={batteryOption} height={200} label={`Battery charging and discharging on ${d.day}`} />
        <dl className="facts">
          <dt>Highest actual load</dt>
          <dd>{num(maxActual, 0)} kW</dd>
          {maxForecast != null && (
            <>
              <dt>Highest forecast</dt>
              <dd>
                {num(maxForecast, 0)} kW ({maxForecast < maxActual ? `${num(maxActual - maxForecast, 0)} kW too low` : 'not too low'})
              </dd>
            </>
          )}
          <dt>Highest grid draw</dt>
          <dd className={maxGrid > contract ? 'neg' : 'pos'}>
            {num(maxGrid, 0)} kW · {overSlots} of 96 intervals above the {num(contract, 0)} kW contract
          </dd>
          <dt>Worst interval (plain MLP plan)</dt>
          <dd>
            {d.worst_at}, {PERIOD_LABEL[d.worst_period as keyof typeof PERIOD_LABEL]} price
          </dd>
        </dl>
        {d.worst_period === 'off_peak' ? (
          <p className="note">
            Outside summer there are two weekday peak periods (06:00–11:00 and 14:00–24:00). To use the battery in both, the plan
            recharges in the off-peak gap at midday, when the load is already high. When the midday load is higher than forecast,
            the charging pushes the grid draw over the contract. Discharging at the highest load does not change this, because the
            midday charging is what the prices call for; the excess is billed at the lower off-peak rate.
          </p>
        ) : (
          <p className="note">
            Every interval of a {d.worst_period === 'peak' ? 'summer peak' : 'Saturday semi-peak'} period costs the same. When the
            forecast stays under the contract, the plain plan has no reason to prefer one hour over another and may use the battery
            early, leaving nothing for the real peak. The second planner adds a tiny cost on high grid draw, so it discharges where
            the forecast load is highest, which is usually where the real peak arrives. Switch between the two planners to compare.
          </p>
        )}
      </section>
    </div>
  )
}
