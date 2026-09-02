import {
  type AdminForecast,
  type GameState,
  type MetricPotentialRange,
  metricKeys,
  type StageKey,
  type StageState,
} from '@ai-sdlc/contracts';
import { stageLabels, stageStateLabels } from '../labels';

type PotentialProps = { forecast?: AdminForecast | null; state: GameState };

export function StagePotential({ forecast, stage, state }: PotentialProps & { stage: StageKey }) {
  const potential = forecast?.stagePotentials.find((item) => item.stage === stage);
  if (!potential) return null;
  const metrics = metricKeys.filter((key) => isChangedRange(potential.metricRanges[key]));
  return (
    <span className="admin-potential">
      <small>Диапазон вариантов</small>
      <span className="potential-chips">
        {metrics.length === 0 && <span>Метрики без изменений</span>}
        {metrics.map((key) => (
          <span className={rangeClass(potential.metricRanges[key])} key={key}>
            {state.metricDefinitions[key].label} {formatRange(potential.metricRanges[key])}
          </span>
        ))}
      </span>
      <StageOutcomes outcomes={potential.stageChanges} />
    </span>
  );
}

export function ActionPotential({
  actionId,
  forecast,
  state,
}: PotentialProps & { actionId: string }) {
  const potential = forecast?.actionPotentials.find((item) => item.actionId === actionId);
  if (!potential) return null;
  const metrics = metricKeys.filter((key) => (potential.metricDelta[key] ?? 0) !== 0);
  return (
    <span className="admin-potential">
      <small>Если выберут сейчас</small>
      <span className="potential-chips">
        {metrics.length === 0 && <span>Метрики без изменений</span>}
        {metrics.map((key) => (
          <span className={valueClass(potential.metricDelta[key] ?? 0)} key={key}>
            {state.metricDefinitions[key].label} {formatSigned(potential.metricDelta[key] ?? 0)}
          </span>
        ))}
      </span>
      <StageOutcomes
        outcomes={potential.stageChanges.map((change) => ({ ...change, states: [change.state] }))}
      />
    </span>
  );
}

function StageOutcomes({ outcomes }: { outcomes: { stage: StageKey; states: StageState[] }[] }) {
  if (outcomes.length === 0) {
    return <span className="potential-stages">Этапы останутся как есть</span>;
  }
  return (
    <span className="potential-stages">
      {outcomes.map((outcome) => (
        <span key={outcome.stage}>
          {stageLabels[outcome.stage]} →{' '}
          {outcome.states.map((value) => stageStateLabels[value]).join(' / ')}
        </span>
      ))}
    </span>
  );
}

function isChangedRange(range: MetricPotentialRange) {
  return range.minimum !== 0 || range.maximum !== 0;
}

function formatRange(range: MetricPotentialRange) {
  if (range.minimum === range.maximum) return formatSigned(range.minimum);
  return `${formatSigned(range.minimum)}…${formatSigned(range.maximum)}`;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function rangeClass(range: MetricPotentialRange) {
  if (range.maximum <= 0) return 'is-negative';
  if (range.minimum >= 0) return 'is-positive';
  return 'is-mixed';
}

function valueClass(value: number) {
  return value < 0 ? 'is-negative' : 'is-positive';
}
