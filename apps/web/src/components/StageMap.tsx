import type { AppliedActionView, GameState, MetricKey, StageKey } from '@ai-sdlc/contracts';
import {
  gridStyle,
  metricLabel,
  presentationFor,
  propertyLabel,
  stageLabel,
} from '../presentation';

export function StageMap({ compact = false, state }: { compact?: boolean; state: GameState }) {
  const won = state.phase === 'WON';
  const presentation = presentationFor(state);
  return (
    <section className={won ? 'map-section victory-map' : 'map-section'}>
      <StageMapHeading compact={compact} state={state} won={won} />
      <div
        className={compact ? 'stage-grid stage-grid-compact' : 'stage-grid'}
        style={gridStyle(presentation.stages.length)}
      >
        {presentation.stages.map(({ id }, index) => (
          <StageCard index={index} key={id} showActions={!compact} stage={id} state={state} />
        ))}
      </div>
      {!won && !compact && <AppliedHistory state={state} />}
    </section>
  );
}

function StageMapHeading({
  compact,
  state,
  won,
}: {
  compact: boolean;
  state: GameState;
  won: boolean;
}) {
  const { copy } = presentationFor(state);
  if (compact) {
    return (
      <div className="section-heading">
        <h2>{copy.stageMapTitle}</h2>
      </div>
    );
  }
  return (
    <div className="section-heading">
      <p className="eyebrow">{won ? 'Итоговая карта' : copy.stageMapEyebrow}</p>
      <h2>{won ? copy.victoryMapTitle : 'Что уже поменяли'}</h2>
    </div>
  );
}

function StageCard({ index, showActions, stage, state }: StageCardProps) {
  const progress = state.stageProgress?.[stage];
  const stageState = progress?.state ?? state.stages[stage] ?? 'AS_IS';
  const actions = progress?.appliedActions ?? [];
  const presentation = presentationFor(state);
  return (
    <article
      className={`stage-card stage-${stageState.toLowerCase()}${showActions ? '' : ' stage-card-compact'}`}
    >
      <span>{String(index + 1).padStart(2, '0')}</span>
      <span className="stage-card-main">
        <strong>{stageLabel(presentation, stage)}</strong>
        <small>{presentation.stageStateLabels[stageState]}</small>
      </span>
      {showActions && (
        <StageActionSummary
          actions={actions}
          progress={progress}
          won={state.phase === 'WON'}
          activeLabel={presentation.copy.activeActionLabel}
        />
      )}
    </article>
  );
}

function StageActionSummary({ actions, activeLabel, progress, won }: StageActionSummaryProps) {
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
      <small>{active ? activeLabel : 'Последнее решение'}</small>
      <b>{active?.title ?? latest?.title}</b>
      {lastChange && <small>Последнее решение на этапе</small>}
      {lastChange && <b>{lastChange.title}</b>}
    </span>
  );
}

type StageActionSummaryProps = {
  activeLabel: string;
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
  if (actions.length === 0 && state.properties.length === 0) return null;
  return (
    <>
      <PreparedProperties state={state} />
      {actions.length > 0 && (
        <section className="applied-history">
          <p className="eyebrow">История решений</p>
          <ActionHistoryList actions={actions} state={state} />
        </section>
      )}
    </>
  );
}

function PreparedProperties({ state }: { state: GameState }) {
  if (state.properties.length === 0) return null;
  return (
    <section className="prepared-properties">
      <p className="eyebrow">Что команда уже подготовила</p>
      <div className="property-list">
        {state.properties.map((property) => (
          <strong key={property}>{propertyLabel(presentationFor(state), property)}</strong>
        ))}
      </div>
    </section>
  );
}

function ActionHistoryList({ actions, state }: { actions: AppliedActionView[]; state: GameState }) {
  return (
    <ul className="applied-history-list">
      {actions.map((action) => (
        <li key={`${action.roundNumber}:${action.actionId}`}>
          <div className="applied-history-heading">
            <span>
              {state.decisionModel === 'STAGE_ACTION_V2' ? 'Ход' : 'Раунд'} {action.roundNumber}
            </span>
            <strong>
              {stageLabel(presentationFor(state), action.stage)} · {action.title}
            </strong>
          </div>
          <HistoryImpact action={action} state={state} />
        </li>
      ))}
    </ul>
  );
}

function historyActions(state: GameState): AppliedActionView[] {
  if (state.appliedActionHistory) return state.appliedActionHistory;
  return presentationFor(state)
    .stages.flatMap(({ id }) => state.stageProgress?.[id]?.appliedActions ?? [])
    .sort((left, right) => right.roundNumber - left.roundNumber);
}

function HistoryImpact({ action, state }: { action: AppliedActionView; state: GameState }) {
  if (!action.impact) return null;
  const changes = presentationFor(state).metricOrder.filter(
    (key) => (action.impact?.metricDelta[key] ?? 0) !== 0,
  );
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
              {metricLabel(state, key)} {formatSigned(action.impact?.metricDelta[key] ?? 0)}
            </span>
            <MetricReasons action={action} metric={key} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricReasons({ action, metric }: { action: AppliedActionView; metric: MetricKey }) {
  const reasons = action.impact?.reasons[metric] ?? [];
  if (reasons.length === 0) return null;
  return <p>{[...new Set(reasons)].join(' ')}</p>;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function metricClass(value: number) {
  return value < 0 ? 'is-negative' : 'is-positive';
}
