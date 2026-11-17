import type { Results } from '../data.ts'
import { MODEL_LABELS } from '../data.ts'
import { ALL_MODELS, maxOf, type Filters } from '../filters.ts'
import { int, num } from '../format.ts'

interface Props {
  results: Results
  filters: Filters
  onChange: (f: Filters) => void
  passing: number
}

/** Control panel: training size, compute budgets and model selection */
export default function Sidebar({ results, filters, onChange, passing }: Props) {
  const memMax = maxOf(results.runs, 'rss_delta_mb')
  const latMax = maxOf(results.runs, 'latency_ms_median')
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch })

  return (
    <aside className="side" aria-label="Control panel">
      <h2 className="side-h">Control panel</h2>

      <fieldset className="field">
        <legend>Training size (rows)</legend>
        <div className="seg mono" role="radiogroup">
          {results.meta.dataset_sizes.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={filters.size === s}
              className={filters.size === s ? 'on' : ''}
              onClick={() => set({ size: s })}
            >
              {int(s)}
            </button>
          ))}
        </div>
      </fieldset>

      <h3 className="side-sub">Compute budget</h3>
      <label className="field" htmlFor="mem">
        <span>
          Training memory ≤ <b className="num">{num(filters.memoryLimitMb, 1)} MB</b>
        </span>
        <input
          id="mem"
          type="range"
          min={0}
          max={Math.ceil(memMax)}
          step={0.5}
          value={filters.memoryLimitMb}
          onChange={(e) => set({ memoryLimitMb: Number(e.target.value) })}
        />
      </label>
      <label className="field" htmlFor="lat">
        <span>
          Latency per row ≤ <b className="num">{num(filters.latencyLimitMs, 3)} ms</b>
        </span>
        <input
          id="lat"
          type="range"
          min={0}
          max={Math.ceil(latMax * 100) / 100}
          step={0.001}
          value={filters.latencyLimitMs}
          onChange={(e) => set({ latencyLimitMs: Number(e.target.value) })}
        />
      </label>

      <fieldset className="field">
        <legend>Models</legend>
        {ALL_MODELS.map((m) => (
          <label key={m} className="check-row">
            <input
              type="checkbox"
              checked={filters.models.includes(m)}
              onChange={(e) =>
                set({ models: e.target.checked ? [...filters.models, m] : filters.models.filter((x) => x !== m) })
              }
            />
            <span className={`dot dot-${m}`} aria-hidden="true" />
            {MODEL_LABELS[m]}
          </label>
        ))}
      </fieldset>

      <p className="side-count">
        <b className="num">{passing}</b> of {results.meta.runs} runs meet the budget
      </p>

      <dl className="side-meta">
        <dt>Data</dt>
        <dd>
          {results.meta.client}, every {results.meta.interval_minutes} min, {results.meta.unit}
        </dd>
        <dt>Hardware</dt>
        <dd>
          {String(results.meta.hardware.cpu)}, single thread
        </dd>
      </dl>
    </aside>
  )
}
