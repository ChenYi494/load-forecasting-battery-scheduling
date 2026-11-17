import { useEffect, useState } from 'react'
import { loadResults, type Results } from './data.ts'
import { day, int } from './format.ts'

const SECTIONS = [
  { id: 'overview', title: 'Question and key results' },
  { id: 'comparison', title: 'Model comparison' },
  { id: 'data-size', title: 'Effect of training size' },
  { id: 'forecast', title: 'Forecasts and extrapolation' },
  { id: 'methods', title: 'Methods, corrections and limits' },
]

export default function App() {
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadResults().then(setResults).catch((e: Error) => setError(e.message))
  }, [])

  return (
    <div className="page">
      <header className="masthead">
        <p className="eyebrow">Electricity load forecasting benchmark</p>
        <h1>How much does a better model beat “use the last value”?</h1>
        {results && (
          <p className="lede">
            Linear regression, MLP and random forest forecast the next 15 minutes of one client’s load ({results.meta.client},{' '}
            {results.meta.unit}), tested on {int(results.meta.test_rows)} unseen intervals from {day(results.meta.test_start)} to{' '}
            {day(results.meta.test_end)}, against naive baselines and with their compute cost.
          </p>
        )}
        <nav className="toc" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              {s.title}
            </a>
          ))}
        </nav>
      </header>

      <main>
        {error && (
          <p className="notice" role="alert">
            {error}. Run <code>python -m scripts.export_results</code> to create it.
          </p>
        )}
        {!results && !error && <p className="notice">Loading results…</p>}
        {results &&
          SECTIONS.map((s) => (
            <section key={s.id} id={s.id} className="section">
              <h2>{s.title}</h2>
              <p className="muted">Built in the next steps.</p>
            </section>
          ))}
      </main>

      {results && (
        <footer className="footer">
          Data: <a href={results.meta.dataset_url}>{results.meta.dataset}</a> · {results.meta.runs} runs · generated{' '}
          {results.meta.generated_at.slice(0, 10)}
          {results.meta.git_commit && <> · commit {results.meta.git_commit}</>}
        </footer>
      )}
    </div>
  )
}
