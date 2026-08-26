import {
  type AppliedActionView,
  type GameState,
  type StageKey,
  stageKeys,
} from '@ai-sdlc/contracts';
import { stageLabels, stageStateLabels } from '../labels';

export function StageMap({ state }: { state: GameState }) {
  const won = state.phase === 'WON';
  return (
    <section className={won ? 'map-section victory-map' : 'map-section'}>
      <div className="section-heading">
        <p className="eyebrow">{won ? 'Новая схема работы' : 'Карта процесса'}</p>
        <h2>{won ? 'Что делает AI и что решает человек' : 'Что уже изменилось'}</h2>
      </div>
      <div className="stage-grid">
        {stageKeys.map((key, index) => (
          <StageCard index={index} key={key} stage={key} state={state} />
        ))}
      </div>
      {!won && <AppliedHistory state={state} />}
    </section>
  );
}

function StageCard({ index, stage, state }: { index: number; stage: StageKey; state: GameState }) {
  const progress = state.stageProgress?.[stage];
  const stageState = progress?.state ?? state.stages[stage];
  const actions = progress?.appliedActions ?? [];
  const visibleActions = state.phase === 'WON' ? actions.slice(-1) : actions.slice(-2);
  return (
    <article className={`stage-card stage-${stageState.toLowerCase()}`}>
      <span>{String(index + 1).padStart(2, '0')}</span>
      <span className="stage-card-main">
        <strong>{stageLabels[stage]}</strong>
        <small>{stageStateLabels[stageState]}</small>
      </span>
      {visibleActions.length > 0 && (
        <span className="stage-actions">
          <small>
            {state.phase === 'WON' ? 'Как теперь работает этап' : `Действий: ${actions.length}`}
          </small>
          {visibleActions.map((action) => (
            <b key={`${action.roundNumber}:${action.actionId}`}>{action.title}</b>
          ))}
        </span>
      )}
    </article>
  );
}

function AppliedHistory({ state }: { state: GameState }) {
  const actions = historyActions(state);
  if (actions.length === 0) return null;
  return (
    <section className="applied-history">
      <p className="eyebrow">История решений</p>
      <ul className="applied-history-list">
        {actions.map((action) => (
          <li key={`${action.roundNumber}:${action.actionId}`}>
            <span>
              {state.decisionModel === 'STAGE_ACTION_V2' ? 'Ход' : 'Раунд'} {action.roundNumber}
            </span>
            <strong>
              {stageLabels[action.stage]} · {action.title}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function historyActions(state: GameState): AppliedActionView[] {
  return stageKeys
    .flatMap((stage) => state.stageProgress?.[stage]?.appliedActions ?? [])
    .sort((left, right) => left.roundNumber - right.roundNumber);
}
