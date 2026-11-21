import { useMemo, useState } from 'react'
import Chart from '../components/Chart.tsx'
import { dayChartOption } from '../components/dayChart.ts'
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
  { id: 'flatten', label: 'Improved plan' },
]
const PERIOD_LABEL = { peak: 'peak', semi_peak: 'Saturday semi-peak', off_peak: 'off-peak' } as const

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
  const weekday = new Date(d.day).toLocaleDateString('en-GB', { weekday: 'long' })

  const maxGrid = Math.max(...schedule.grid)
  const maxActual = Math.max(...d.actual)
  const maxForecast = forecast ? Math.max(...forecast) : null
  const overSlots = schedule.grid.filter((g) => g > contract + 1e-6).length

  const option = useMemo(
    () => dayChartOption({ theme, day: d, plan: schedule, contract, planColor: planner === 'plain' ? theme.plain : theme.good, forecast }),
    [theme, d, schedule, contract, planner, forecast],
  )

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <p className="kicker">Client MT_200</p>
        <h2>A day with the battery</h2>
        <p className="muted">Worst day of each month for the plain MLP plan · the plan is made the evening before and run against the real load.</p>
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
                <span className={`dot dot-${METHOD_STYLE[p.id].color === 'perfect' ? 'naive' : METHOD_STYLE[p.id].color}`} aria-hidden="true" />
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
          <span className="muted">
            kW · shaded: {d.period.includes('peak') ? 'peak' : 'Saturday semi-peak'} price · <span className="dot dot-inline" style={{ background: 'var(--over)' }} aria-hidden="true" />over the contract
          </span>
        </div>
        <Chart option={option} height={520} label={`Actual load, forecast, grid draw and battery on ${d.day} with the contract line`} />
        <div className="stat-row">
          <div>
            <span className="sr-k">Peak load</span>
            <span className="sr-v num">{num(maxActual, 0)} kW</span>
          </div>
          {maxForecast != null && (
            <div>
              <span className="sr-k">Peak forecast</span>
              <span className={`sr-v num ${maxForecast < maxActual ? 'neg' : ''}`}>
                {num(maxForecast, 0)} kW{maxForecast < maxActual && ` (−${num(maxActual - maxForecast, 0)})`}
              </span>
            </div>
          )}
          <div>
            <span className="sr-k">Peak grid draw</span>
            <span className={`sr-v num ${maxGrid > contract ? 'neg' : 'pos'}`}>{num(maxGrid, 0)} kW</span>
          </div>
          <div>
            <span className="sr-k">Intervals over contract</span>
            <span className={`sr-v num ${overSlots > 0 ? 'neg' : 'pos'}`}>{overSlots} / 96</span>
          </div>
          <div>
            <span className="sr-k">Worst interval (plain MLP)</span>
            <span className="sr-v num">
              {d.worst_at} · {PERIOD_LABEL[d.worst_period as keyof typeof PERIOD_LABEL]}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
