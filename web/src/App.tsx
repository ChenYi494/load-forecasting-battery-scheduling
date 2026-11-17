import { useEffect, useMemo, useState } from 'react'
import MetricCards from './components/MetricCards.tsx'
import Sidebar from './components/Sidebar.tsx'
import { loadResults, type Results } from './data.ts'
import { defaultFilters, withinBudget, type Filters } from './filters.ts'
import { day, int } from './format.ts'
import Comparison from './sections/Comparison.tsx'
import Overview from './sections/Overview.tsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'comparison', label: 'Model comparison' },
  { id: 'data-size', label: 'Training size' },
  { id: 'forecast', label: 'Forecasts' },
  { id: 'methods', label: 'Methods & limits' },
] as const
type TabId = (typeof TABS)[number]['id']

function tabFromHash(): TabId {
  const id = window.location.hash.slice(1)
  return TABS.some((t) => t.id === id) ? (id as TabId) : 'overview'
}

export default function App() {
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [tab, setTab] = useState<TabId>(tabFromHash)

  useEffect(() => {
    loadResults()
      .then((r) => {
        setResults(r)
        setFilters(defaultFilters(r))
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  // Tabs live in the URL hash so a link can open a specific tab
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const passing = useMemo(() => (results && filters ? withinBudget(results.runs, filters) : []), [results, filters])

  return (
    <div className="desk">
      <header className="bar">
        <div className="bar-name">
          <b>Load forecasting: accuracy vs. compute</b>
          {results && (
            <span>
              UCI {results.meta.client} · test {day(results.meta.test_start)} – {day(results.meta.test_end)} ·{' '}
              {int(results.meta.runs)} runs
            </span>
          )}
        </div>
        <nav className="bar-tabs" aria-label="Views">
          {TABS.map((t) => (
            <a key={t.id} href={`#${t.id}`} className={tab === t.id ? 'active' : ''} aria-current={tab === t.id ? 'page' : undefined}>
              {t.label}
            </a>
          ))}
        </nav>
      </header>

      {error && (
        <p className="notice" role="alert">
          {error}. Run <code>python -m scripts.export_results</code> to create it.
        </p>
      )}
      {!results && !error && <p className="notice">Loading results…</p>}

      {results && filters && (
        <>
          <Sidebar results={results} filters={filters} onChange={setFilters} passing={passing.length} />
          <main className="content">
            <MetricCards results={results} size={filters.size} passing={passing} />
            {tab === 'overview' && <Overview results={results} />}
            {tab === 'comparison' && <Comparison results={results} filters={filters} passing={passing} />}
            {(tab === 'data-size' || tab === 'forecast' || tab === 'methods') && (
              <section className="panel">
                <h2>{TABS.find((t) => t.id === tab)!.label}</h2>
                <p className="muted">Built in the next step.</p>
              </section>
            )}
            <footer className="footer">
              Data: <a href={results.meta.dataset_url}>{results.meta.dataset}</a> · generated{' '}
              {results.meta.generated_at.slice(0, 10)}
              {results.meta.git_commit && <> · commit {results.meta.git_commit}</>}
            </footer>
          </main>
        </>
      )}
    </div>
  )
}
