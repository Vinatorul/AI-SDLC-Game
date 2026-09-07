import type { GameState, ScenarioPresentation } from '@ai-sdlc/contracts';
import { presentationFor, presentationText, stageLabel } from '../presentation';

export function ActivatedActions({ state }: { state: GameState }) {
  const actions = state.currentRound?.activatedActions ?? [];
  const blocked = state.currentRound?.blockedActivations ?? [];
  if (actions.length === 0 && blocked.length === 0) return null;
  return (
    <>
      {actions.length > 0 && (
        <ActivatedList actions={actions} presentation={presentationFor(state)} />
      )}
      {blocked.length > 0 && (
        <BlockedList actions={blocked} presentation={presentationFor(state)} />
      )}
    </>
  );
}

function ActivatedList({
  actions,
  presentation,
}: {
  actions: NonNullable<GameState['currentRound']>['activatedActions'];
  presentation: ScenarioPresentation;
}) {
  return (
    <section className="applied-history" aria-labelledby="activated-actions-title">
      <p className="eyebrow">После хода</p>
      <h2 id="activated-actions-title">Что ещё заработало</h2>
      <ul className="applied-history-list">
        {actions?.map((action) => (
          <li key={`${action.actionId}:${action.completedByActionId}`}>
            <span>{stageLabel(presentation, action.stage)}</span>
            <strong>
              {presentationText(presentation.copy.activatedActionTemplate, {
                action: action.title,
                completedBy: action.completedByTitle,
                stage: stageLabel(presentation, action.stage),
              })}
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockedList({
  actions,
  presentation,
}: {
  actions: NonNullable<GameState['currentRound']>['blockedActivations'];
  presentation: ScenarioPresentation;
}) {
  return (
    <section className="applied-history" aria-labelledby="blocked-actions-title">
      <p className="eyebrow">После хода</p>
      <h2 id="blocked-actions-title">Что пока не заработало</h2>
      <ul className="applied-history-list">
        {actions?.map((action) => (
          <li key={`${action.actionId}:${action.completedByActionId}`}>
            <span>{stageLabel(presentation, action.stage)}</span>
            <strong>{blockedActivationText(action, presentation)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function blockedActivationText(
  action: NonNullable<NonNullable<GameState['currentRound']>['blockedActivations']>[number],
  presentation: ScenarioPresentation,
) {
  const template =
    action.reason === 'STAGE_REPAIRED'
      ? presentation.copy.blockedActivationRepairedTemplate
      : presentation.copy.blockedActivationBrokenTemplate;
  return presentationText(template, {
    action: action.title,
    completedBy: action.completedByTitle,
    stage: stageLabel(presentation, action.stage),
  });
}
