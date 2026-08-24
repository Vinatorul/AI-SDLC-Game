import {
  type EffectBreakdown,
  type GameState,
  type MetricKey,
  metricKeys,
} from '@ai-sdlc/contracts';
import { metricLabels } from '../labels';

type MetricBoardProps = {
  breakdown?: EffectBreakdown | null;
  state: GameState;
};

export function MetricBoard({ breakdown, state }: MetricBoardProps) {
  return (
    <section className="metric-grid" aria-label="Показатели SDLC">
      {metricKeys.map((key) => (
        <MetricCard breakdown={breakdown} key={key} metric={key} state={state} />
      ))}
    </section>
  );
}

function MetricCard({ breakdown, metric, state }: MetricBoardProps & { metric: MetricKey }) {
  const value = state.metrics[metric];
  const delta = breakdown?.total[metric] ?? 0;
  const zone =
    value <= state.rules.criticalThreshold
      ? 'critical'
      : value <= state.rules.dangerThreshold
        ? 'danger'
        : 'safe';
  return (
    <article className={`metric-card metric-${zone}`}>
      <div className="metric-label">
        <span>{metricLabels[metric]}</span>
        {delta !== 0 && <small>{delta > 0 ? `+${delta}` : delta}</small>}
      </div>
      <strong>{value}</strong>
      <div className="metric-track" aria-hidden="true">
        <i style={{ width: `${value}%` }} />
      </div>
    </article>
  );
}
