import type { Results, Run } from '../data.ts'
import { MODEL_LABELS } from '../data.ts'
import { int, num, pct } from '../format.ts'

interface Props {
  results: Results
  size: number
  passing: Run[]
}

/** Headline numbers for the selected training size, recomputed from the runs that meet the budget */
export default function MetricCards({ results, size, passing }: Props) {
  const persistence = results.baselines.find((b) => b.lag_col === 'lag_1')!
  const atSize = passing.filter((r) => r.dataset_size === size && r.model !== 'naive' && r.rmse != null)
  const best = atSize.reduce<Run | null>((a, r) => (a == null || r.rmse! < a.rmse! ? r : a), null)
  const totalAtSize = results.runs.filter((r) => r.dataset_size === size).length
  const passingAtSize = passing.filter((r) => r.dataset_size === size).length
  const gain = best ? ((best.rmse! - persistence.rmse) / persistence.rmse) * 100 : null

  return (
    <div className="tiles">
      <div className="tile t1">
        <span className="tile-k">Best model · {int(size)} rows</span>
        <span className="tile-v">{best ? MODEL_LABELS[best.model] : '—'}</span>
        <span className="tile-n">{best ? best.variant : 'No model meets the budget'}</span>
      </div>
      <div className="tile t2">
        <span className="tile-k">Best RMSE</span>
        <span className="tile-v num">{best ? `${num(best.rmse, 1)} kW` : '—'}</span>
        <span className="tile-n">{best ? `seed ${best.seed}` : ''}</span>
      </div>
      <div className="tile t3">
        <span className="tile-k">vs. persistence ({num(persistence.rmse, 1)} kW)</span>
        <span className={`tile-v num ${gain != null && gain < 0 ? 'pos' : 'neg'}`}>{gain == null ? '—' : pct(gain)}</span>
        <span className="tile-n">Persistence = use the value 15 minutes earlier</span>
      </div>
      <div className="tile t4">
        <span className="tile-k">Runs within budget</span>
        <span className="tile-v num">
          {passingAtSize} / {totalAtSize}
        </span>
        <span className="tile-n">at {int(size)} rows</span>
      </div>
    </div>
  )
}
