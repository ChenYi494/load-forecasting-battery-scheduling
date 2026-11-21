import { useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import Chart from '../components/Chart.tsx'
import { Ticker } from '../components/motion.tsx'
import { useTheme } from '../components/useTheme.ts'
import { METHOD_LABELS, METHOD_STYLE, METHODS, type Decision, type MethodId, type MultiClient, type Planner } from '../decision.ts'
import { int, num } from '../format.ts'

const PLANNER_LABEL: Record<Planner, string> = { plain: 'Plain plan', flatten: 'Improved plan' }
const mean = (v: number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : NaN)
const twd = (v: number) => `NT$${int(Math.round(v))}`
const other = (p: Planner): Planner => (p === 'plain' ? 'flatten' : 'plain')

export default function Dashboard({ decision, mc }: { decision: Decision; mc: MultiClient }) {
  const theme = useTheme()
  const [client, setClient] = useState('MT_200')
  const [method, setMethod] = useState<MethodId>('mlp')
  const [planner, setPlanner] = useState<Planner>('flatten')
  const clients = mc.clients.map((c) => c.client)
  const info = mc.clients.find((c) => c.client === client)!
  const color = (m: MethodId) => theme.series[METHOD_STYLE[m].color]

  const runs = (c: string, p: Planner, m: string) => mc.runs.filter((r) => r.client === c && r.planner === p && r.method === m)
  const acc = (c: string, m: MethodId) => mc.accuracy.filter((a) => a.client === c && a.method === m)
  const share = (c: string, p: Planner, m: MethodId) => mean(runs(c, p, m).map((r) => r.share))

  const sel = runs(client, planner, method)
  const kpi = {
    share: mean(sel.map((r) => r.share)),
    shareMin: Math.min(...sel.map((r) => r.share)),
    shareMax: Math.max(...sel.map((r) => r.share)),
    otherShare: share(client, other(planner), method),
    saving: mean(sel.map((r) => r.saving)),
    perfect: runs(client, planner, 'perfect_foresight')[0]?.saving ?? NaN,
    excess: mean(sel.map((r) => r.excess)),
    months: mean(sel.map((r) => r.months_with_excess)),
    rmse: mean(acc(client, method).map((a) => a.rmse)),
  }
  const byRmse = [...METHODS].sort((a, b) => mean(acc(client, a).map((x) => x.rmse)) - mean(acc(client, b).map((x) => x.rmse)))
  const byBill = [...METHODS].sort((a, b) => share(client, planner, b) - share(client, planner, a))
  const delta = kpi.share - kpi.otherShare

  // A: every client, plain vs improved, for the selected forecast; click a row to pick the client
  const dumbbell = useMemo<EChartsOption>(() => {
    const rows = clients.map((c) => ({ c, plain: share(c, 'plain', method), good: share(c, 'flatten', method) }))
    const pt = (v: number, c: string, base: string) => ({
      value: [v, c],
      symbolSize: c === client ? 16 : 11,
      itemStyle: { color: base, borderColor: c === client ? theme.fg : 'transparent', borderWidth: 2, opacity: c === client ? 1 : 0.8 },
    })
    return {
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 62, right: 40, top: 30, bottom: 30 },
      legend: { top: 0, textStyle: { color: theme.muted }, data: ['Plain plan', 'Improved plan'] },
      tooltip: { trigger: 'item', formatter: (p) => { const d = p as unknown as { seriesName: string; value: [number, string] }; return `${d.value[1]} · ${d.seriesName}<br/>${num(d.value[0], 1)}% of the perfect-forecast saving` } },
      xAxis: { type: 'value', min: (v) => Math.max(0, Math.floor((v.min - 3) / 10) * 10), max: 100, axisLabel: { color: theme.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: theme.line } } },
      yAxis: {
        type: 'category',
        data: clients,
        inverse: true,
        axisLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, fontFamily: 'IBM Plex Mono', fontWeight: (v: string) => (v === client ? 700 : 400) } as never,
      },
      series: [
        ...rows.map((r) => ({
          type: 'line' as const,
          symbol: 'none',
          silent: true,
          lineStyle: { color: r.c === client ? theme.good : theme.line, width: r.c === client ? 6 : 4, cap: 'round' as const, opacity: r.c === client ? 0.45 : 1 },
          data: [[r.plain, r.c], [r.good, r.c]],
          tooltip: { show: false },
        })),
        { name: 'Plain plan', type: 'scatter', itemStyle: { color: theme.plain }, data: rows.map((r) => pt(r.plain, r.c, theme.plain)) },
        {
          name: 'Improved plan',
          type: 'scatter',
          itemStyle: { color: theme.good },
          data: rows.map((r) => pt(r.good, r.c, theme.good)),
          label: { show: true, position: 'right', color: theme.good, fontSize: 11, formatter: (p) => `+${num(rows[p.dataIndex].good - rows[p.dataIndex].plain, 1)}` },
        },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, mc, method, client])

  // B: the five forecasts on the selected client, both planners; click a bar to pick the forecast
  const bars = useMemo<EChartsOption>(() => {
    const bar = (p: Planner) => METHODS.map((m) => ({
      value: share(client, p, m),
      itemStyle: { color: p === 'plain' ? theme.plain : color(m), opacity: m === method ? 1 : 0.38, borderRadius: [3, 3, 0, 0] },
    }))
    const values = METHODS.flatMap((m) => [share(client, 'plain', m), share(client, 'flatten', m)])
    return {
      textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
      grid: { left: 44, right: 12, top: 30, bottom: 44 },
      legend: { top: 0, textStyle: { color: theme.muted }, data: ['Plain plan', 'Improved plan'] },
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${num(Number(v), 1)}%` },
      xAxis: { type: 'category', data: METHODS.map((m) => METHOD_LABELS[m]), axisLine: { lineStyle: { color: theme.line } }, axisLabel: { color: theme.muted, interval: 0, width: 80, overflow: 'break', fontSize: 11 } },
      yAxis: { type: 'value', min: Math.max(0, Math.floor(Math.min(...values) / 5) * 5 - 5), max: 100, axisLabel: { color: theme.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: theme.line } } },
      series: [
        { name: 'Plain plan', type: 'bar', barMaxWidth: 22, itemStyle: { color: theme.plain }, data: bar('plain') },
        { name: 'Improved plan', type: 'bar', barMaxWidth: 22, itemStyle: { color: theme.good }, data: bar('flatten') },
      ],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, mc, client, method])

  // C: accuracy (RMSE) against value (share) for every forecast and seed on the selected client
  const scatter = useMemo<EChartsOption>(() => ({
    textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
    grid: { left: 48, right: 16, top: 30, bottom: 44 },
    tooltip: { trigger: 'item', formatter: (p) => { const d = p as unknown as { seriesName: string; value: [number, number, string] }; return `${d.seriesName}${d.value[2]}<br/>RMSE ${num(d.value[0], 1)} kW · ${num(d.value[1], 1)}%` } },
    xAxis: { type: 'value', scale: true, name: 'RMSE (kW) → less accurate', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: theme.muted }, axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: theme.muted, formatter: '{value}%' }, splitLine: { lineStyle: { color: theme.line } } },
    series: METHODS.map((m) => {
      const r = runs(client, planner, m)
      const a = acc(client, m)
      return {
        name: METHOD_LABELS[m],
        type: 'scatter' as const,
        symbolSize: m === method ? 15 : 10,
        itemStyle: { color: color(m), opacity: m === method ? 1 : 0.55, borderColor: m === method ? theme.fg : 'transparent', borderWidth: 1.5 },
        data: r.map((x) => [a.find((y) => y.seed === x.seed)?.rmse ?? NaN, x.share, x.seed != null ? ` · seed ${x.seed}` : '']),
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme, mc, client, planner, method])

  const s = mc.summary
  const agg = {
    gap: s[`${planner}_median_model_gap`],
    aboveSeed: s[`${planner}_gap_above_seed_spread`],
    corr: s[`${planner}_median_rank_corr_rmse`],
    learned: s[`${planner}_learned_beats_naive`],
  }

  const listShare = (c: string) => share(c, planner, method)

  return (
    <div className="bench">
      <aside className="side" aria-label="Selection">
        <h2 className="side-h">Experiment</h2>
        <dl className="side-meta">
          <dt>Clients</dt>
          <dd>{mc.clients.length} (UCI, Portugal)</dd>
          <dt>Test</dt>
          <dd>{decision.meta.test_days} days, Mar–Dec 2014</dd>
          <dt>Forecasts</dt>
          <dd>5 methods × 3 seeds</dd>
          <dt>Tariff</dt>
          <dd>Taipower high-voltage TOU</dd>
        </dl>

        <fieldset className="field">
          <legend>Planning rule</legend>
          <div className="seg" role="radiogroup">
            {(['plain', 'flatten'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={planner === p} className={planner === p ? 'on' : ''} onClick={() => setPlanner(p)}>
                {PLANNER_LABEL[p]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="field">
          <legend>Forecast</legend>
          {METHODS.map((m) => (
            <label key={m} className="check-row">
              <input type="radio" name="forecast" checked={method === m} onChange={() => setMethod(m)} />
              <span className={`dot dot-${METHOD_STYLE[m].color}`} aria-hidden="true" />
              {METHOD_LABELS[m]}
            </label>
          ))}
        </fieldset>

        <fieldset className="field">
          <legend>Client · share kept</legend>
          <div className="client-list" role="radiogroup">
            {clients.map((c) => {
              const v = listShare(c)
              return (
                <button key={c} type="button" role="radio" aria-checked={client === c} className={client === c ? 'on' : ''} onClick={() => setClient(c)}>
                  <span className="cl-id">{c}</span>
                  <span className="cl-bar" aria-hidden="true">
                    <i style={{ width: `${Math.max(0, v)}%`, background: planner === 'plain' ? 'var(--plain)' : 'var(--good)' }} />
                  </span>
                  <span className="cl-v num">{num(v, 0)}%</span>
                </button>
              )
            })}
          </div>
        </fieldset>
        <p className="side-count">Click a chart to change the selection.</p>
      </aside>

      <div className="bench-main">
        <header className="page-head tight">
          <p className="run-id">
            exp/decision-layer · {mc.clients.length} clients · {decision.meta.test_days} test days · {planner === 'plain' ? 'plain' : 'improved'} rule
          </p>
          <h1>Day-ahead load forecasts × battery scheduling</h1>
        </header>

      <div className="tiles">
        <div className="tile t3">
          <span className="tile-k">Share of the perfect-forecast saving</span>
          <span className="tile-v"><Ticker value={kpi.share} format={(v) => `${num(v, 1)}%`} /></span>
          <span className="gauge" aria-hidden="true">
            <span className="gauge-fill" style={{ width: `${Math.max(0, Math.min(100, kpi.share))}%` }} />
            <span className="gauge-mark" style={{ left: `${Math.max(0, Math.min(100, kpi.otherShare))}%` }} />
          </span>
          <span className="tile-n">
            <b className={delta >= 0 ? 'pos' : 'neg'}><Ticker value={delta} format={(v) => `${v >= 0 ? '+' : '−'}${num(Math.abs(v), 1)} pts`} /></b> vs {PLANNER_LABEL[other(planner)].toLowerCase()}
            {sel.length > 1 && <> · seeds {num(kpi.shareMin, 1)}–{num(kpi.shareMax, 1)}%</>}
          </span>
        </div>
        <div className="tile t2">
          <span className="tile-k">Saving against no battery</span>
          <span className="tile-v"><Ticker value={kpi.saving} format={twd} /></span>
          <span className="tile-n">perfect forecast: {twd(kpi.perfect)} ({num(info.perfect_saving_pct, 1)}% of the bill)</span>
        </div>
        <div className="tile t1">
          <span className="tile-k">Excess-demand charge</span>
          <span className="tile-v"><Ticker value={kpi.excess} format={twd} /></span>
          <span className="tile-n">months with an overrun: {num(kpi.months, 1)} of 10 · contract {int(info.contract_battery_kw)} kW</span>
        </div>
        <div className="tile t4">
          <span className="tile-k">Day-ahead RMSE</span>
          <span className="tile-v"><Ticker value={kpi.rmse} format={(v) => `${num(v, 1)} kW`} /></span>
          <span className="tile-n">
            rank {byRmse.indexOf(method) + 1} of 5 by RMSE · rank {byBill.indexOf(method) + 1} of 5 by bill
          </span>
        </div>
      </div>

      <div className="dash-grid">
        <section className="panel c7">
          <div className="panel-h">
            <h2>All clients · {METHOD_LABELS[method]}</h2>
            <span className="muted">share of the perfect-forecast saving · click a client</span>
          </div>
          <Chart option={dumbbell} height={360} onClick={(p) => { const v = p.value as [number, string]; if (Array.isArray(v) && typeof v[1] === 'string') setClient(v[1]) }} label="Dumbbell chart of the share of the perfect-forecast saving for every client, plain and improved plan" />
        </section>

        <section className="panel c5">
          <div className="panel-h">
            <h2>{client} · five forecasts</h2>
            <span className="muted">click a bar</span>
          </div>
          <Chart option={bars} height={360} onClick={(p) => setMethod(METHODS[p.dataIndex])} label={`Share of the perfect-forecast saving for five forecasts on ${client}, both planning rules`} />
        </section>

        <section className="panel c6">
          <div className="panel-h">
            <h2>{client} · accuracy vs. value</h2>
            <span className="muted">
              {PLANNER_LABEL[planner].toLowerCase()} · Spearman(RMSE, bill) {num(info[planner].rank_corr_rmse, 2)}
            </span>
          </div>
          <Chart option={scatter} height={300} onClick={(p) => { const m = METHODS.find((x) => METHOD_LABELS[x] === p.seriesName); if (m) setMethod(m) }} label={`Scatter of RMSE against share of the saving for each forecast and seed on ${client}`} />
        </section>

        <section className="panel c6">
          <div className="panel-h">
            <h2>Across all {mc.clients.length} clients · {PLANNER_LABEL[planner].toLowerCase()}</h2>
            <span className="muted">switch the planning rule to compare</span>
          </div>
          <div className="agg">
            <div>
              <span className="agg-v"><Ticker value={agg.gap} format={(v) => `${num(v, 1)} pts`} /></span>
              <span className="agg-k">median gap, best vs. worst forecast</span>
            </div>
            <div>
              <span className="agg-v"><Ticker value={agg.aboveSeed} format={(v) => `${Math.round(v)} / ${mc.clients.length}`} /></span>
              <span className="agg-k">clients where that gap beats seed noise</span>
            </div>
            <div>
              <span className="agg-v"><Ticker value={agg.corr} format={(v) => num(v, 2)} /></span>
              <span className="agg-k">median rank correlation, RMSE vs. bill</span>
            </div>
            <div>
              <span className="agg-v"><Ticker value={agg.learned} format={(v) => `${Math.round(v)} / ${mc.clients.length}`} /></span>
              <span className="agg-k">clients where a learned model beats both naive forecasts</span>
            </div>
            <div>
              <span className="agg-v good"><Ticker value={s.flatten_gain_mean} format={(v) => `+${num(v, 1)} pts`} /></span>
              <span className="agg-k">mean gain from the improved rule ({num(s.flatten_gain_min, 1)}–{num(s.flatten_gain_max, 1)})</span>
            </div>
          </div>
        </section>
      </div>
      </div>
    </div>
  )
}
