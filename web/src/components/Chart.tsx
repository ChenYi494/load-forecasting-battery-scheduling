import { useEffect, useRef } from 'react'
import type { EChartsOption } from 'echarts'
import echarts from './echarts.ts'

/** The fields of an ECharts click event this site uses */
export interface ChartClick {
  seriesName?: string
  name?: string
  dataIndex: number
  value: unknown
}

interface Props {
  option: EChartsOption
  onClick?: (params: ChartClick) => void
  height?: number
  /** Text alternative for screen readers */
  label: string
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Minimal ECharts wrapper: one instance per mount, option updates, follows the container size */
export default function Chart({ option, onClick, height = 320, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null)
  const clickRef = useRef(onClick)
  useEffect(() => {
    clickRef.current = onClick
  }, [onClick])

  useEffect(() => {
    if (!ref.current) return
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.current.on('click', (p) => clickRef.current?.(p as unknown as ChartClick))
    const observer = new ResizeObserver(() => chart.current?.resize())
    observer.observe(ref.current)
    return () => {
      observer.disconnect()
      chart.current?.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption({ animation: !reducedMotion(), ...option }, { notMerge: true, lazyUpdate: true })
  }, [option])

  return <div ref={ref} role="img" aria-label={label} style={{ width: '100%', height, cursor: onClick ? 'pointer' : undefined }} />
}
