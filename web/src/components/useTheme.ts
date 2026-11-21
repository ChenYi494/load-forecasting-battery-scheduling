import { useEffect, useState } from 'react'

/** Chart colors read from the CSS tokens, refreshed when the system theme changes */
export interface ThemeColors {
  fg: string
  muted: string
  line: string
  surface: string
  series: Record<string, string>
  /** Decision-layer colors: peak-price shading, battery, overruns, the two planners */
  peakBg: string
  charge: string
  discharge: string
  over: string
  plain: string
  good: string
}

function read(): ThemeColors {
  const s = getComputedStyle(document.documentElement)
  const v = (name: string) => s.getPropertyValue(name).trim()
  return {
    fg: v('--fg'),
    muted: v('--muted'),
    line: v('--line'),
    surface: v('--surface'),
    peakBg: v('--peak-bg'),
    charge: v('--charge'),
    discharge: v('--discharge'),
    over: v('--over'),
    plain: v('--plain'),
    good: v('--good'),
    series: {
      actual: v('--fg'),
      perfect: v('--accent'),
      naive: v('--c-naive'),
      linear: v('--c-linear'),
      mlp: v('--c-mlp'),
      rf: v('--c-rf'),
    },
  }
}

export function useTheme(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(read)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setColors(read())
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  return colors
}
