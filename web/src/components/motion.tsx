import { useEffect, useRef, useState, type ReactNode } from 'react'
import { reducedMotion, useInView } from './inView.ts'

/** Fades and lifts its content in when it scrolls into view */
export function Reveal({ children, className = '', as: Tag = 'section' }: { children: ReactNode; className?: string; as?: 'section' | 'div' }) {
  const [ref, inView] = useInView<HTMLElement>(0.12)
  return (
    <Tag ref={ref as never} className={`reveal ${inView ? 'in' : ''} ${className}`}>
      {children}
    </Tag>
  )
}

/** Counts from 0 to value when it first scrolls into view */
export function CountUp({ value, digits = 0, prefix = '', suffix = '' }: { value: number; digits?: number; prefix?: string; suffix?: string }) {
  const [ref, inView] = useInView<HTMLSpanElement>(0.5)
  const [shown, setShown] = useState(0)
  const still = reducedMotion()
  useEffect(() => {
    if (!inView || still) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 1100)
      setShown(value * (1 - Math.pow(1 - t, 3)))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [inView, value, still])
  return (
    <span ref={ref} className="num">
      {prefix}
      {(still ? value : shown).toFixed(digits)}
      {suffix}
    </span>
  )
}

/** A number that animates from its previous value whenever value changes */
export function Ticker({ value, digits = 0, format }: { value: number; digits?: number; format?: (v: number) => string }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  const still = reducedMotion()
  useEffect(() => {
    if (still) return
    const start = performance.now()
    const a = from.current
    let frame = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 650)
      const v = a + (value - a) * (1 - Math.pow(1 - t, 3))
      setShown(v)
      from.current = v
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, still])
  const v = still ? value : shown
  return <span className="num">{format ? format(v) : v.toFixed(digits)}</span>
}
