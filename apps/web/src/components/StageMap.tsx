import {
  type AppliedActionView,
  type GameState,
  metricKeys,
  type StageKey,
  stageKeys,
} from '@ai-sdlc/contracts';
import { stageLabels, stageStateLabels } from '../labels';

export function StageMap({ compact = false, state }: { compact?: boolean; state: GameState }) {
  const won = state.phase === 'WON';
  return (
    <section className={won ? 'map-section victory-map' : 'map-section'}>
      <StageMapHeading compact={compact} won={won} />
      <div className={compact ? 'stage-grid stage-grid-compact' : 'stage-grid'}>
        {stageKeys.map((key, index) => (
          <StageCard index={index} key={key} showActions={!compact} stage={key} state={state} />
        ))}
      </div>
      {!won && !compact && <AppliedHistory state={state} />}
    </section>
  );
}

function StageMapHeading({ compact, won }: { compact: boolean; won: boolean }) {
  if (compact) {
    return (
      <div className="section-heading">
        <h2>Состояние SDLC</h2>
      </div>
    );
  }
  return (
    <div className="section-heading">
      <p className="eyebrow">{won ? 'Итоговая карта' : 'Карта SDLC'}</p>
      <h2>{won ? 'Как теперь работает SDLC' : 'Что уже поменяли'}</h2>
    </div>
  );
}

function StageCard({ index, showActions, stage, state }: StageCardProps) {
  const progress = state.stageProgress?.[stage];
  const stageState = progress?.state ?? state.stages[stage];
  const actions = progress?.appliedActions ?? [];
  return (
    <article
      className={`stage-card stage-${stageState.toLowerCase()}${showActions ? '' : ' stage-card-compact'}`}
    >
      <span>{String(index + 1).padStart(2, '0')}</span>
      <span className="stage-card-main">
        <strong>{stageLabels[stage]}</strong>
        <small>{stageStateLabels[stageState]}</small>
      </span>
      {showActions && (
        <StageActionSummary actions={actions} progress={progress} won={state.phase === 'WON'} />
      )}
    </article>
  );
}

function StageActionSummary({ actions, progress, won }: StageActionSummaryProps) {
  if (actions.length === 0) return null;
  if (!won) {
    return (
      <span className="stage-actions">
        <small>Решений: {actions.length}</small>
        {actions.slice(-2).map((action) => (
          <b key={`${action.roundNumber}:${action.actionId}`}>{action.title}</b>
        ))}
      </span>
    );
  }
  const active = progress?.activeAiAction;
  const latest = actions.at(-1);
  const lastChange = latest && !sameAction(latest, active) ? latest : null;
  return (
    <span className="stage-actions">
      <small>{active ? 'AI-решение' : 'Последнее решение'}</small>
      <b>{active?.title ?? latest?.title}</b>
      {lastChange && <small>Последнее решение на этапе</small>}
      {lastChange && <b>{lastChange.title}</b>}
    </span>
  );
}

type StageActionSummaryProps = {
  actions: AppliedActionView[];
  progress?: GameState['stageProgress'][StageKey];
  won: boolean;
};

function sameAction(left?: AppliedActionView, right?: AppliedActionView | null) {
  return left?.actionId === right?.actionId && left?.roundNumber === right?.roundNumber;
}

type StageCardProps = {
  index: number;
  showActions: boolean;
  stage: StageKey;
  state: GameState;
};

export function AppliedHistory({ state }: { state: GameState }) {
  const actions = historyActions(state);
  if (actions.length === 0) return null;
  return (
    <section className="applied-history">
      <p className="eyebrow">История решений</p>
      <ul className="applied-history-list">
        {actions.map((action) => (
          <li key={`${action.roundNumber}:${action.actionId}`}>
            <div className="applied-history-heading">
              <span>
                {state.decisionModel === 'STAGE_ACTION_V2' ? 'Ход' : 'Раунд'} {action.roundNumber}
              </span>
              <strong>
                {stageLabels[action.stage]} · {action.title}
              </strong>
            </div>
            <HistoryImpact action={action} state={state} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function historyActions(state: GameState): AppliedActionView[] {
  if (state.appliedActionHistory) return state.appliedActionHistory;
  return stageKeys
    .flatMap((stage) => state.stageProgress?.[stage]?.appliedActions ?? [])
    .sort((left, right) => right.roundNumber - left.roundNumber);
}

function HistoryImpact({ action, state }: { action: AppliedActionView; state: GameState }) {
  if (!action.impact) return null;
  const changes = metricKeys.filter((key) => (action.impact?.metricDelta[key] ?? 0) !== 0);
  return (
    <div className="applied-history-impact">
      <ul className="applied-history-effects">
        {changes.length === 0 && (
          <li>
            <span>Метрики без изменений</span>
          </li>
        )}
        {changes.map((key) => (
          <li key={key}>
            <span className={metricClass(action.impact?.metricDelta[key] ?? 0)}>
              {state.metricDefinitions[key].label}{' '}
              {formatSigned(action.impact?.metricDelta[key] ?? 0)}
            </span>
            <MetricReasons action={action} metric={key} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricReasons({ action, metric }: { action: AppliedActionView; metric: StageMetricKey }) {
  const reasons = action.impact?.reasons[metric] ?? [];
  if (reasons.length === 0) return null;
  return <p>{[...new Set(reasons)].join(' ')}</p>;
}

type StageMetricKey = (typeof metricKeys)[number];

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function metricClass(value: number) {
  return value < 0 ? 'is-negative' : 'is-positive';
}
