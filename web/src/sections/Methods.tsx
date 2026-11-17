import { Fragment } from 'react'
import { MODEL_LABELS, type ModelId, type Results } from '../data.ts'
import { day, int, num } from '../format.ts'

const LEARNED: Exclude<ModelId, 'naive'>[] = ['linear', 'mlp', 'rf']

// What the March 2026 version got wrong and what changed (see the repository history for each commit)
const CORRECTIONS: { problem: string; fix: string; impact: 'High' | 'Medium' | 'Low' }[] = [
  {
    problem: 'Each training size was tested on a different period (the last 20% of the first N rows), so sizes could not be compared.',
    fix: 'One fixed test period for every run; training size only changes how many rows before it are used.',
    impact: 'High',
  },
  {
    problem: 'MLP early stopping stored a reference to the weights instead of a copy, and the best weights were not restored when training ran to the end.',
    fix: 'The best weights are deep-copied and always restored.',
    impact: 'High',
  },
  {
    problem: 'Zero readings were removed before building lag features, so near those gaps lag_96 was not the value 24 hours earlier.',
    fix: 'Lags are computed on the complete 15-minute timeline, then invalid rows are removed.',
    impact: 'High',
  },
  {
    problem: 'The MLP was trained on unscaled kW targets with unshuffled batches, and PyTorch was not seeded.',
    fix: 'Standardized target, shuffled batches within the training window, seeded PyTorch.',
    impact: 'Medium',
  },
  {
    problem: 'Latency was one time.time() call around the whole test set, so it changed with test size and often read 0.',
    fix: 'Per-row latency with perf_counter after a warm-up, repeated, reported as median and p95.',
    impact: 'Medium',
  },
  {
    problem: 'Memory came from tracemalloc, which misses PyTorch and scikit-learn allocations, and all runs shared one process.',
    fix: 'Process RSS sampled every 10 ms during training, each run in a fresh process.',
    impact: 'Medium',
  },
  {
    problem: 'A custom “resource efficiency” score with arbitrary floors and offsets ranked the models.',
    fix: 'Removed. Accuracy and each cost are reported separately and compared on the scatter plot.',
    impact: 'Low',
  },
  {
    problem: 'There was no naive baseline, so it was unclear whether any model was useful.',
    fix: 'Added persistence (value 15 minutes earlier) and the value 24 hours earlier.',
    impact: 'High',
  },
  {
    problem: 'The dashboard labelled kW as MW and showed hard-coded verdicts and a simulated “stress test”.',
    fix: 'Units corrected; every number on this site is computed from the exported results.',
    impact: 'Medium',
  },
]

export default function Methods({ results }: { results: Results }) {
  const { meta, runs, before, groups } = results
  const variants = (m: ModelId) => [...new Set(runs.filter((r) => r.model === m).map((r) => r.variant))]
  const seeds = [...new Set(runs.filter((r) => r.model !== 'naive').map((r) => r.seed))].sort((a, b) => a - b)
  const now = (m: ModelId, s: number) => groups.find((g) => g.model === m && g.dataset_size === s)?.rmse.median ?? null
  const march = (m: ModelId, s: number) => before.find((b) => b.model === m && b.dataset_size === s)?.rmse_median ?? null

  return (
    <div className="panel-grid">
      <section className="panel span-2">
        <h2>Experiment design</h2>
        <dl className="facts">
          <dt>Task</dt>
          <dd>
            Predict {meta.target} for client {meta.client} from {meta.features.join(', ')}. This is a retrospective test on
            historical data, not a live forecasting service.
          </dd>
          <dt>Split</dt>
          <dd>
            Test period {day(meta.test_start)} – {day(meta.test_end)} ({int(meta.test_rows)} intervals, the last 20% of the
            data), identical for every run. Training uses the {meta.dataset_sizes.map(int).join(', ')} rows immediately before
            it; the last 10% of those rows validate the MLP's early stopping. Features are standardized with training statistics
            only.
          </dd>
          <dt>Baselines</dt>
          <dd>{results.baselines.map((b) => `${b.variant}: ${num(b.rmse, 1)} kW RMSE`).join(' · ')}</dd>
          {LEARNED.map((m) => (
            <div key={m} className="fact">
              <dt>{MODEL_LABELS[m]}</dt>
              <dd>
                {variants(m).length} configurations × {seeds.length} seeds × {meta.dataset_sizes.length} sizes:{' '}
                <span className="muted">{variants(m).join('; ')}</span>
              </dd>
            </div>
          ))}
          <dt>Accuracy</dt>
          <dd>RMSE and MAE in kW on the test period.</dd>
          {Object.entries(meta.protocol).map(([k, v]) => (
            <div key={k} className="fact">
              <dt>{k[0].toUpperCase() + k.slice(1)}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <dt>Machine</dt>
          <dd>
            {String(meta.hardware.cpu)}, {String(meta.hardware.ram_gb)} GB RAM, {String(meta.hardware.os)}; Python{' '}
            {String(meta.hardware.python)}, scikit-learn {String(meta.hardware.scikit_learn)}, PyTorch {String(meta.hardware.torch)}
          </dd>
        </dl>
      </section>

      <section className="panel span-2">
        <h2>What the March 2026 version got wrong</h2>
        <p className="muted">
          This benchmark was first built in March 2026. A review in November 2026 found the problems below; all runs were
          repeated after fixing them.
        </p>
        <div className="table-wrap">
          <table className="wrap">
            <thead>
              <tr>
                <th scope="col">Problem in March</th>
                <th scope="col">Fix</th>
                <th scope="col">Effect on conclusions</th>
              </tr>
            </thead>
            <tbody>
              {CORRECTIONS.map((c) => (
                <tr key={c.problem}>
                  <td>{c.problem}</td>
                  <td>{c.fix}</td>
                  <td>
                    <span className={`impact ${c.impact.toLowerCase()}`}>{c.impact}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel span-2">
        <h2>Median RMSE before and after the fixes (kW)</h2>
        <p className="muted">
          March numbers come from different test periods per size, so the two columns are not a like-for-like comparison. They
          show which conclusions changed: the MLP anomaly disappeared, and the small random forest went from best to worst once
          it had to forecast a later season.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Model</th>
                {meta.dataset_sizes.map((s) => (
                  <th key={s} scope="col" className="n" colSpan={2}>
                    {int(s)} rows
                  </th>
                ))}
              </tr>
              <tr>
                <th scope="col" />
                {meta.dataset_sizes.map((s) => (
                  <Fragment key={s}>
                    <th scope="col" className="n">March</th>
                    <th scope="col" className="n">Now</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEARNED.map((m) => (
                <tr key={m}>
                  <th scope="row"><span className={`dot dot-${m}`} aria-hidden="true" />{MODEL_LABELS[m]}</th>
                  {meta.dataset_sizes.map((s) => (
                    <Fragment key={s}>
                      <td className="n muted">{num(march(m, s), 1)}</td>
                      <td className="n">{num(now(m, s), 1)}</td>
                    </Fragment>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Limitations</h2>
        <ul className="findings">
          <li>One client ({meta.client}) and one test period; results may differ for other load profiles or a rolling evaluation.</li>
          <li>
            The task is easy for linear models: lag_1 (the value 15 minutes earlier) is a strong feature, which is why
            persistence is hard to beat. Day-ahead forecasting would be harder.
          </li>
          <li>Data is from 2011–2014; this is a retrospective comparison of methods, not a forecast of current demand.</li>
          <li>Timings come from one laptop, single-threaded; absolute numbers will differ on other hardware, the ordering less so.</li>
          <li>Memory is the increase in process RSS during training, which includes temporary allocations as well as the model.</li>
          <li>Hyperparameter grids are small (see Experiment design); no model was tuned beyond them.</li>
        </ul>
      </section>

      <section className="panel">
        <h2>Reproduce</h2>
        <pre className="code">{`python -m scripts.download_data
python -m utils.prepare_uci_data
python -m utils.generate_naive_cfg   # and linear, mlp, rf
python -m main                       # ${meta.runs} runs
python -m scripts.export_results     # writes web/public/results.json`}</pre>
        <p className="muted">
          Results generated {meta.generated_at.slice(0, 10)}
          {meta.git_commit && <> from commit {meta.git_commit}</>}.
        </p>
      </section>
    </div>
  )
}
