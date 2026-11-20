import { useEffect, useMemo, useState } from 'react'
import MetricCards from './components/MetricCards.tsx'
import Sidebar from './components/Sidebar.tsx'
import { loadResults, type Results } from './data.ts'
import { loadDecision, type Decision } from './decision.ts'
import { defaultFilters, withinBudget, type Filters } from './filters.ts'
import { day, int } from './format.ts'
import Backtest from './sections/Backtest.tsx'
import Clients from './sections/Clients.tsx'
import Comparison from './sections/Comparison.tsx'
import DataSize from './sections/DataSize.tsx'
import DayAhead from './sections/DayAhead.tsx'
import Decisions from './sections/Decisions.tsx'
import Forecast from './sections/Forecast.tsx'
import Methods from './sections/Methods.tsx'
import Overview from './sections/Overview.tsx'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'comparison', label: 'Model comparison' },
  { id: 'data-size', label: 'Training size' },
  { id: 'forecast', label: 'Forecasts' },
  { id: 'methods', label: 'Methods & limits' },
  { id: 'day-ahead', label: 'Day-ahead' },
  { id: 'decisions', label: 'Battery decisions' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'clients', label: 'Ten clients' },
] as const
type TabId = (typeof TABS)[number]['id']
// Tabs for task B and the decision layer: no training-size budget, so no sidebar
const DECISION_TABS: TabId[] = ['day-ahead', 'decisions', 'backtest', 'clients']

function tabFromHash(): TabId {
  const id = window.location.hash.slice(1)
  return TABS.some((t) => t.id === id) ? (id as TabId) : 'overview'
}

export default function App() {
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters | null>(null)
  const [tab, setTab] = useState<TabId>(tabFromHash)
  const [decision, setDecision] = useState<Decision | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  useEffect(() => {
    loadResults()
      .then((r) => {
        setResults(r)
        setFilters(defaultFilters(r))
      })
      .catch((e: Error) => setError(e.message))
    loadDecision()
      .then(setDecision)
      .catch((e: Error) => setDecisionError(e.message))
  }, [])

  // Tabs live in the URL hash so a link can open a specific tab
  useEffect(() => {
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const decisionTab = DECISION_TABS.includes(tab)
  const passing = useMemo(() => (results && filters ? withinBudget(results.runs, filters) : []), [results, filters])

  return (
    <div className={decisionTab ? 'desk wide' : 'desk'}>
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
          {error}. Run <code>python -m benchmark.export</code> to create it.
        </p>
      )}
      {!results && !error && <p className="notice">Loading results…</p>}

      {results && filters && (
        <>
          {!decisionTab && <Sidebar results={results} filters={filters} onChange={setFilters} passing={passing.length} />}
          <main className="content">
            {!decisionTab && <MetricCards results={results} size={filters.size} passing={passing} />}
            {tab === 'overview' && <Overview results={results} />}
            {tab === 'comparison' && <Comparison results={results} filters={filters} passing={passing} />}
            {tab === 'data-size' && <DataSize results={results} filters={filters} passing={passing} />}
            {tab === 'forecast' && <Forecast results={results} />}
            {tab === 'methods' && <Methods results={results} />}
            {decisionTab && decisionError && (
              <p className="empty" role="alert">
                {decisionError}. Run <code>python -m benchmark.decision.export</code> to create it.
              </p>
            )}
            {decisionTab && !decision && !decisionError && <p className="empty">Loading decision results…</p>}
            {decision && tab === 'day-ahead' && <DayAhead decision={decision} />}
            {decision && tab === 'decisions' && <Decisions decision={decision} />}
            {decision && tab === 'backtest' && <Backtest decision={decision} />}
            {decision && tab === 'clients' &&
              (decision.multiclient ? (
                <Clients mc={decision.multiclient} />
              ) : (
                <p className="empty">
                  No multi-client results yet. Run <code>python -m benchmark.multiclient.run</code>, then the summary and export.
                </p>
              ))}
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
