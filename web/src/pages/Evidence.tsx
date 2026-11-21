import type { Decision } from '../decision.ts'
import Backtest from '../sections/Backtest.tsx'
import Clients from '../sections/Clients.tsx'
import DayAhead from '../sections/DayAhead.tsx'

const PARTS = [
  { id: 'ten-clients', label: 'Ten clients' },
  { id: 'mt200-backtest', label: 'MT_200 backtest' },
  { id: 'day-ahead', label: 'Day-ahead accuracy' },
]

/** Every number behind the story, for readers who want to check it */
export default function Evidence({ decision }: { decision: Decision }) {
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="page">
      <header className="page-head">
        <p className="kicker">All results</p>
        <h1>The evidence</h1>
        <nav className="jump" aria-label="On this page">
          {PARTS.map((p) => (
            <button key={p.id} type="button" onClick={() => jump(p.id)}>
              {p.label}
            </button>
          ))}
        </nav>
      </header>
      <section id="ten-clients" className="part">
        <h2 className="part-h">Ten clients</h2>
        {decision.multiclient ? <Clients mc={decision.multiclient} /> : <p className="empty">Run benchmark.multiclient to create these results.</p>}
      </section>
      <section id="mt200-backtest" className="part">
        <h2 className="part-h">MT_200 backtest</h2>
        <Backtest decision={decision} />
      </section>
      <section id="day-ahead" className="part">
        <h2 className="part-h">Day-ahead accuracy</h2>
        <DayAhead decision={decision} />
      </section>
    </div>
  )
}
