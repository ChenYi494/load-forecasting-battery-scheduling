import { useEffect, useRef } from 'react'
import type { EChartsOption } from 'echarts'
import echarts from './echarts.ts'

interface Props {
  option: EChartsOption
  height?: number
  /** Text alternative for screen readers */
  label: string
}

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Minimal ECharts wrapper: one instance per mount, option updates, follows the container size */
export default function Chart({ option, height = 320, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    chart.current = echarts.init(ref.current, undefined, { renderer: 'canvas' })
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

  return <div ref={ref} role="img" aria-label={label} style={{ width: '100%', height }} />
}
