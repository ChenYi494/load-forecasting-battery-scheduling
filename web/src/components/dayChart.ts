import type { EChartsOption } from 'echarts'
import type { Day, DayPlan } from '../decision.ts'
import { num } from '../format.ts'
import type { ThemeColors } from './useTheme.ts'

export const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`)

/** Contiguous runs of a non-off-peak tariff period, as [first, last] slot indexes */
function priceBlocks(period: string[]) {
  const blocks: [number, number][] = []
  period.forEach((p, i) => {
    if (p === 'off_peak') return
    const last = blocks[blocks.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else blocks.push([i, i])
  })
  return blocks
}

/** First and last slot of the longest run of discharging */
function dischargeWindow(discharge: number[]) {
  let best: [number, number] | null = null
  let start = -1
  discharge.forEach((d, i) => {
    if (d > 0 && start < 0) start = i
    if ((d <= 0 || i === discharge.length - 1) && start >= 0) {
      const end = d > 0 ? i : i - 1
      if (!best || end - start > best[1] - best[0]) best = [start, end]
      start = -1
    }
  })
  return best as [number, number] | null
}

export interface DayChartInput {
  theme: ThemeColors
  day: Day
  plan: DayPlan
  contract: number
  planColor: string
  forecast?: number[] | null
  compact?: boolean
}

/** Load (top) and battery (bottom) for one day, annotated on the chart itself */
export function dayChartOption({ theme, day, plan, contract, planColor, forecast, compact }: DayChartInput): EChartsOption {
  const over = plan.grid.map((g) => g - contract)
  const worst = over.reduce((bi, v, i) => (v > over[bi] ? i : bi), 0)
  const peakActual = day.actual.reduce((bi, v, i) => (v > day.actual[bi] ? i : bi), 0)
  const window = dischargeWindow(plan.discharge)
  const label = (text: string, color: string) => ({
    show: true,
    formatter: text,
    color,
    fontSize: 12,
    fontWeight: 600 as const,
    backgroundColor: theme.surface,
    borderColor: color,
    borderWidth: 1,
    borderRadius: 4,
    padding: [3, 6],
  })
  const axis = { lineStyle: { color: theme.line } }
  const loadTop = compact ? 24 : 36

  return {
    textStyle: { color: theme.fg, fontFamily: 'IBM Plex Sans' },
    animationDuration: 1200,
    animationDurationUpdate: 700,
    legend: compact ? undefined : { top: 0, textStyle: { color: theme.muted }, data: ['Actual load', 'Forecast used to plan', 'Drawn from the grid'] },
    tooltip: { trigger: 'axis', valueFormatter: (v) => (v == null ? '—' : `${num(Math.abs(Number(v)), 0)} kW`) },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 52, right: 18, top: loadTop, height: compact ? '56%' : '58%' },
      { left: 52, right: 18, bottom: 28, height: compact ? '18%' : '20%' },
    ],
    xAxis: [
      { type: 'category', gridIndex: 0, data: TIMES, axisLine: axis, axisLabel: { show: false }, axisTick: { show: false } },
      { type: 'category', gridIndex: 1, data: TIMES, axisLine: axis, axisLabel: { color: theme.muted, interval: 11 } },
    ],
    yAxis: [
      { type: 'value', gridIndex: 0, scale: true, axisLabel: { color: theme.muted }, splitLine: { lineStyle: { color: theme.line } } },
      {
        type: 'value',
        gridIndex: 1,
        name: 'battery',
        nameTextStyle: { color: theme.muted, align: 'left' },
        splitNumber: 2,
        axisLabel: { color: theme.muted, formatter: (v: number) => num(Math.abs(v), 0) },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Actual load',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: theme.fg, width: 1.3, opacity: 0.75 },
        itemStyle: { color: theme.fg },
        data: day.actual,
        markArea: { silent: true, itemStyle: { color: theme.peakBg }, data: priceBlocks(day.period).map(([a, b]) => [{ xAxis: TIMES[a] }, { xAxis: TIMES[b] }]) },
        markLine: {
          symbol: 'none',
          silent: true,
          lineStyle: { color: theme.over, type: 'dashed', width: 1.2 },
          label: { formatter: `contract ${num(contract, 0)} kW`, color: theme.over, position: 'insideStartTop' },
          data: [{ yAxis: contract }],
        },
        markPoint: compact
          ? undefined
          : {
              symbol: 'circle',
              symbolSize: 7,
              itemStyle: { color: theme.fg },
              label: { ...label(`real peak ${TIMES[peakActual]}`, theme.fg), position: 'top', distance: 10 },
              data: [{ name: 'real peak', coord: [TIMES[peakActual], day.actual[peakActual]] }],
            },
      },
      ...(forecast
        ? [{ name: 'Forecast used to plan', type: 'line' as const, symbol: 'none', lineStyle: { color: planColor, width: 1.2, type: 'dotted' as const }, itemStyle: { color: planColor }, data: forecast }]
        : []),
      {
        name: 'Drawn from the grid',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: planColor, width: 2.2 },
        itemStyle: { color: planColor },
        data: plan.grid,
        markPoint: {
          symbol: 'circle',
          symbolSize: 9,
          itemStyle: { color: over[worst] > 0 ? theme.over : planColor },
          label: {
            ...label(
              over[worst] > 0 ? `${TIMES[worst]}  +${num(over[worst], 0)} kW over contract` : `highest draw ${num(plan.grid[worst] + 0, 0)} kW, under contract`,
              over[worst] > 0 ? theme.over : planColor,
            ),
            position: worst > 60 ? 'left' : 'right',
            distance: 12,
          },
          data: [{ name: 'highest draw', coord: [TIMES[worst], over[worst] > 0 ? plan.grid[worst] : Math.max(...plan.grid)] }],
        },
      },
      {
        name: 'Above contract',
        type: 'line',
        symbol: 'none',
        lineStyle: { color: theme.over, width: 3.2 },
        itemStyle: { color: theme.over },
        data: plan.grid.map((g) => (g > contract ? g : null)),
        tooltip: { show: false },
      },
      { name: 'Charging', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, stack: 'b', itemStyle: { color: theme.charge }, data: plan.charge },
      {
        name: 'Discharging',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        stack: 'b',
        itemStyle: { color: theme.discharge },
        data: plan.discharge.map((v) => -v),
        markArea: window
          ? {
              silent: true,
              itemStyle: { color: 'transparent' },
              label: { ...label(`discharging ${TIMES[window[0]]}–${TIMES[Math.min(window[1] + 1, 95)]}`, theme.discharge), position: 'insideTop' },
              data: [[{ xAxis: TIMES[window[0]] }, { xAxis: TIMES[window[1]] }]],
            }
          : undefined,
      },
    ],
  }
}
