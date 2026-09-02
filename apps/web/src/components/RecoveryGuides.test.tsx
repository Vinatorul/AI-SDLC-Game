import type { GameState, RecoveryGuideView } from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { RecoveryGuides } from './RecoveryGuides';

it('показывает ведущему сначала подготовку, затем ремонт нескольких этапов', () => {
  const html = renderToStaticMarkup(<RecoveryGuides state={stateWith(eventRecovery)} />);
  expect(html).toContain('Что сделать дальше');
  expect(html).toContain('Сначала подготовьте');
  expect(html).toContain('Добавить автотесты на критичные сценарии');
  expect(html).toContain('Затем почините этапы');
  expect(html).toContain('Написание кода');
  expect(html.indexOf('Сначала подготовьте')).toBeLessThan(html.indexOf('Затем почините этапы'));
});

it('показывает инструкцию для заблокированного AI-решения', () => {
  const state = stateWith(null);
  state.currentRound = {
    ...state.currentRound,
    blockedActivations: [
      {
        actionId: 'testing.test-generation-skill',
        completedByActionId: 'testing.behavior-checks',
        completedByTitle: 'Добавить автотесты',
        reason: 'STAGE_BROKEN',
        recovery: blockedRecovery,
        stage: 'testing',
        title: 'Собрать скилл генерации тестов',
      },
    ],
  } as NonNullable<GameState['currentRound']>;
  const html = renderToStaticMarkup(<RecoveryGuides state={state} />);
  expect(html).toContain('Сначала выберите решение, которое чинит тестирование.');
  expect(html).toContain('Добавить автотесты на критичные сценарии');
});

const eventRecovery: RecoveryGuideView = {
  hostHint: 'Сначала подготовьте автотесты, затем вернитесь к коду.',
  prerequisiteActions: [
    {
      actionId: 'testing.behavior-checks',
      stage: 'testing',
      title: 'Добавить автотесты на критичные сценарии',
    },
  ],
  repairActions: [
    {
      actionId: 'coding.guided-implementation',
      stage: 'coding',
      title: 'Писать код с AI и проверять каждое изменение',
    },
    {
      actionId: 'review.risk-policy',
      stage: 'review',
      title: 'Записать правила ревью и обязательные проверки',
    },
  ],
};

const blockedRecovery: RecoveryGuideView = {
  hostHint: 'Сначала выберите решение, которое чинит тестирование.',
  prerequisiteActions: [],
  repairActions: eventRecovery.prerequisiteActions,
};

function stateWith(recovery: RecoveryGuideView | null): GameState {
  return { currentRound: { recovery } } as GameState;
}
