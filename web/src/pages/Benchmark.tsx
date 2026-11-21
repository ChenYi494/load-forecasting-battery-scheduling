import { useMemo, useState } from 'react'
import MetricCards from '../components/MetricCards.tsx'
import Sidebar from '../components/Sidebar.tsx'
import type { Results } from '../data.ts'
import { defaultFilters, withinBudget, type Filters } from '../filters.ts'
import { day, int } from '../format.ts'
import Comparison from '../sections/Comparison.tsx'
import DataSize from '../sections/DataSize.tsx'
import Forecast from '../sections/Forecast.tsx'
import Methods from '../sections/Methods.tsx'
import Overview from '../sections/Overview.tsx'
import { BENCH_TABS, type BenchTab } from './benchTabs.ts'

/** Appendix: task A, next-15-minute forecasting, accuracy against compute cost */
export default function Benchmark({ results, sub }: { results: Results; sub: BenchTab }) {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(results))
  const passing = useMemo(() => withinBudget(results.runs, filters), [results, filters])

  return (
    <div className="bench">
      <Sidebar results={results} filters={filters} onChange={setFilters} passing={passing.length} />
      <div className="bench-main">
        <header className="page-head tight">
          <p className="kicker">Appendix · task A</p>
          <h1>Next-15-minute forecasting: accuracy vs. compute</h1>
          <p className="muted">
            {int(results.meta.runs)} runs on {results.meta.client}, test {day(results.meta.test_start)} – {day(results.meta.test_end)}. Set compute budgets in the side panel.
          </p>
          <nav className="subtabs" aria-label="Benchmark views">
            {BENCH_TABS.map((t) => (
              <a key={t.id} href={`#benchmark/${t.id}`} className={sub === t.id ? 'active' : ''} aria-current={sub === t.id ? 'page' : undefined}>
                {t.label}
              </a>
            ))}
          </nav>
        </header>
        <MetricCards results={results} size={filters.size} passing={passing} />
        {sub === 'overview' && <Overview results={results} />}
        {sub === 'comparison' && <Comparison results={results} filters={filters} passing={passing} />}
        {sub === 'data-size' && <DataSize results={results} filters={filters} passing={passing} />}
        {sub === 'forecast' && <Forecast results={results} />}
        {sub === 'methods' && <Methods results={results} />}
      </div>
    </div>
  )
}
