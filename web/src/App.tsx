import { useEffect, useState } from 'react'
import { loadResults, type Results } from './data.ts'
import { loadDecision, type Decision } from './decision.ts'
import Benchmark from './pages/Benchmark.tsx'
import { BENCH_TABS, type BenchTab } from './pages/benchTabs.ts'
import Evidence from './pages/Evidence.tsx'
import Dashboard from './pages/Dashboard.tsx'
import Decisions from './sections/Decisions.tsx'

const PAGES = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'day', label: 'A day with the battery' },
  { id: 'evidence', label: 'All results' },
  { id: 'benchmark', label: 'Appendix: benchmark' },
] as const
type PageId = (typeof PAGES)[number]['id']

// Links to the earlier tab layout keep working
const LEGACY: Record<string, string> = {
  story: 'dashboard',
  decisions: 'day',
  backtest: 'evidence',
  clients: 'evidence',
  'day-ahead': 'evidence',
  ...Object.fromEntries(BENCH_TABS.map((t) => [t.id, `benchmark/${t.id}`])),
}

function route(): { page: PageId; sub: BenchTab } {
  const raw = window.location.hash.slice(1)
  const hash = LEGACY[raw] ?? raw
  const [page, sub] = hash.split('/')
  return {
    page: PAGES.some((p) => p.id === page) ? (page as PageId) : 'dashboard',
    sub: BENCH_TABS.some((t) => t.id === sub) ? (sub as BenchTab) : 'overview',
  }
}

export default function App() {
  const [results, setResults] = useState<Results | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [errors, setErrors] = useState<{ results?: string; decision?: string }>({})
  const [{ page, sub }, setRoute] = useState(route)

  useEffect(() => {
    loadResults()
      .then(setResults)
      .catch((e: Error) => setErrors((x) => ({ ...x, results: e.message })))
    loadDecision()
      .then(setDecision)
      .catch((e: Error) => setErrors((x) => ({ ...x, decision: e.message })))
  }, [])

  // Pages live in the URL hash so a link can open a specific page
  useEffect(() => {
    const onHash = () => {
      setRoute(route())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // Pages with the left control panel: it runs the full height and the footer sits in the right column
  const withSidebar = page === 'benchmark' || page === 'dashboard'
  const needs = page === 'benchmark' ? 'results' : 'decision'
  const error = errors[needs]
  const ready = needs === 'results' ? results : decision

  return (
    <div className={withSidebar ? 'site has-side' : 'site'}>
      <header className="topnav">
        <a className="brand" href="#dashboard">
          <span className="brand-mark" aria-hidden="true" />
          <span>Load Forecasting × Battery Scheduling</span>
        </a>
        <nav aria-label="Pages">
          {PAGES.map((p) => (
            <a key={p.id} href={`#${p.id}`} className={page === p.id ? 'active' : ''} aria-current={page === p.id ? 'page' : undefined}>
              {p.label}
            </a>
          ))}
        </nav>
      </header>

      <main className={withSidebar ? 'main bench-wrap' : 'main'}>
        {error && (
          <p className="empty" role="alert">
            {error}. Run <code>{needs === 'results' ? 'python -m benchmark.export' : 'python -m benchmark.decision.export'}</code> to create it.
          </p>
        )}
        {!ready && !error && <p className="empty">Loading…</p>}
        {decision && page === 'dashboard' &&
          (decision.multiclient ? <Dashboard decision={decision} mc={decision.multiclient} /> : <p className="empty">Run benchmark.multiclient to create the ten-client results.</p>)}
        {decision && page === 'day' && (
          <div className="page">
            <Decisions decision={decision} />
          </div>
        )}
        {decision && page === 'evidence' && <Evidence decision={decision} />}
        {results && page === 'benchmark' && <Benchmark results={results} sub={sub} />}
      </main>

      <footer className="site-foot">
        Data: <a href="https://archive.ics.uci.edu/dataset/321/electricityloaddiagrams20112014">UCI ElectricityLoadDiagrams20112014</a> · Tariff:
        Taipower high-voltage two-stage TOU (2025-10) ·{' '}
        <a href="https://github.com/ChenYi494/load-forecasting-battery-scheduling">GitHub</a>
        {decision?.meta.git_commit && <> · commit {decision.meta.git_commit}</>}
      </footer>
    </div>
  )
}
