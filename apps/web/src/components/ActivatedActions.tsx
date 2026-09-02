import type { GameState } from '@ai-sdlc/contracts';
import { stageLabels } from '../labels';

export function ActivatedActions({ state }: { state: GameState }) {
  const actions = state.currentRound?.activatedActions ?? [];
  const blocked = state.currentRound?.blockedActivations ?? [];
  if (actions.length === 0 && blocked.length === 0) return null;
  return (
    <>
      {actions.length > 0 && <ActivatedList actions={actions} />}
      {blocked.length > 0 && <BlockedList actions={blocked} />}
    </>
  );
}

function ActivatedList({
  actions,
}: {
  actions: NonNullable<GameState['currentRound']>['activatedActions'];
}) {
  return (
    <section className="applied-history" aria-labelledby="activated-actions-title">
      <p className="eyebrow">После хода</p>
      <h2 id="activated-actions-title">Что ещё заработало</h2>
      <ul className="applied-history-list">
        {actions?.map((action) => (
          <li key={`${action.actionId}:${action.completedByActionId}`}>
            <span>{stageLabels[action.stage]}</span>
            <strong>
              После «{action.completedByTitle}» заработало AI-решение «{action.title}».
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function BlockedList({
  actions,
}: {
  actions: NonNullable<GameState['currentRound']>['blockedActivations'];
}) {
  return (
    <section className="applied-history" aria-labelledby="blocked-actions-title">
      <p className="eyebrow">После хода</p>
      <h2 id="blocked-actions-title">Что пока не заработало</h2>
      <ul className="applied-history-list">
        {actions?.map((action) => (
          <li key={`${action.actionId}:${action.completedByActionId}`}>
            <span>{stageLabels[action.stage]}</span>
            <strong>{blockedActivationText(action)}</strong>
          </li>
        ))}
      </ul>
    </section>
  );
}

function blockedActivationText(
  action: NonNullable<NonNullable<GameState['currentRound']>['blockedActivations']>[number],
) {
  const stage = stageLabels[action.stage];
  if (action.reason === 'STAGE_REPAIRED') {
    return `Этап «${stage}» снова работает без AI после решения «${action.completedByTitle}». Чтобы включить «${action.title}», снова выберите это AI-решение.`;
  }
  return `AI-решение «${action.title}» пока не заработало: этап «${stage}» всё ещё сломан. Сначала почините этап, затем снова выберите это решение.`;
}
