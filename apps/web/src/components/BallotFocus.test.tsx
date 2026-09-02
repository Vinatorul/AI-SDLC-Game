import type {
  ActionBallotChoice,
  ActionPotentialView,
  AdminForecast,
  GameState,
} from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { BallotFocus } from './BallotFocus';

it('показывает ведущему разбор победителя и не больше двух заметных вариантов', () => {
  const html = renderToStaticMarkup(<BallotFocus state={resultState()} />);
  expect(html).toContain('Разбор победителя');
  expect(html).toContain('Разбор второго варианта');
  expect(html).toContain('Разбор третьего варианта');
  expect(html).not.toContain('Разбор четвёртого варианта');
});

it('показывает ведущему точные баллы и изменения SDLC на варианте', () => {
  const html = renderToStaticMarkup(
    <BallotFocus forecast={actionForecast()} state={resultState()} />,
  );
  expect(html).toContain('Если выберут сейчас');
  expect(html).toContain('TTM +2');
  expect(html).toContain('Качество -1');
  expect(html).toContain('Ревью → AI встроен');
  expect(html).toContain('Условия: готово 1 из 3 · активных рисков 1');
  expect(html).toContain('Помогает получить плюс');
  expect(html).toContain('Автоматические тесты');
  expect(html).toContain('Правила ревью');
  expect(html).toContain('TTM: этап «Ревью» работает');
  expect(html).toContain('Может ухудшить');
  expect(html).toContain('Код готов, а ревью не успело');
  expect(html).toContain('Сработает сейчас');
  expect(html).toContain('Раньше не выбрано ни одно: Правила ревью');
  expect(html).toContain('is-active');
  expect(html).toContain('is-inactive');
});

it('показывает ведущему диапазон баллов на карточке этапа', () => {
  const state = resultState();
  state.currentBallot = {
    choices: [{ description: '', id: 'review', kind: 'STAGE', stage: 'review', title: 'Ревью' }],
    id: 'stage-ballot',
    kind: 'STAGE',
    selectedChoiceId: null,
    stage: null,
    tiedChoiceIds: [],
    voteTallies: [],
  };
  const html = renderToStaticMarkup(<BallotFocus forecast={stageForecast()} state={state} />);
  expect(html).toContain('Диапазон вариантов');
  expect(html).toContain('TTM -2…+1');
  expect(html).toContain('Ревью → Работает как раньше / Сломано');
});

it('не падает без новых полей прогноза от предыдущей версии API', () => {
  const forecast = actionForecast();
  const potential = forecast.actionPotentials[0] as Partial<ActionPotentialView>;
  delete potential.activationRequirements;
  delete potential.eventBranches;
  delete potential.positiveEffectRequirements;
  expect(() =>
    renderToStaticMarkup(<BallotFocus forecast={forecast} state={resultState()} />),
  ).not.toThrow();
});

function resultState(): GameState {
  const choices = [
    'победителя',
    'второго варианта',
    'третьего варианта',
    'четвёртого варианта',
  ].map(choice);
  return {
    currentBallot: {
      choices,
      id: 'action-ballot',
      kind: 'ACTION',
      selectedChoiceId: 'action-0',
      stage: 'review',
      tiedChoiceIds: [],
      voteTallies: [0.4, 0.3, 0.2, 0.1].map((share, index) => ({
        choiceId: `action-${index}`,
        count: share * 10,
        share,
      })),
    },
    currentRound: { number: 1, title: 'Проверяем варианты' },
    metricDefinitions: metricDefinitions(),
    phase: 'RESULT',
    properties: [],
    rules: { notableVoteShare: 0.2 },
    stageProgress: { review: { appliedActions: [], state: 'AS_IS' } },
  } as unknown as GameState;
}

function actionForecast(): AdminForecast {
  return {
    actionPotentials: [actionPotential()],
    ballotId: 'action-ballot',
    kind: 'ACTION',
    revision: 1,
    stagePotentials: [],
    transitionVersion: 1,
  };
}

function actionPotential(): ActionPotentialView {
  return {
    actionId: 'action-0',
    activationRequirements: [
      { actionId: 'testing.behavior-checks', satisfied: true, title: 'Автоматические тесты' },
      { actionId: 'review.risk-policy', satisfied: false, title: 'Правила ревью' },
    ],
    eventBranches: [riskBranch()],
    metricDelta: { deliverySpeed: 2, quality: -1 },
    positiveEffectRequirements: [{ metric: 'deliverySpeed', satisfied: false, stage: 'review' }],
    stageChanges: [{ stage: 'review', state: 'AI_ENABLED' }],
  };
}

function riskBranch(): ActionPotentialView['eventBranches'][number] {
  return {
    conditions: [
      {
        actionIds: ['review.risk-policy'],
        expected: 'NOT_APPLIED',
        kind: 'ACTION_HISTORY',
        satisfied: true,
        titles: ['Правила ревью'],
      },
    ],
    eventId: 'review-queue',
    influence: 'WORSENS',
    matched: true,
    selected: true,
    title: 'Код готов, а ревью не успело',
  };
}

function stageForecast(): AdminForecast {
  const zero = { maximum: 0, minimum: 0 };
  return {
    actionPotentials: [],
    ballotId: 'stage-ballot',
    kind: 'STAGE',
    revision: 1,
    stagePotentials: [
      {
        actionCount: 4,
        metricRanges: {
          controllability: zero,
          deliverySpeed: { maximum: 1, minimum: -2 },
          quality: zero,
          teamCapacity: zero,
        },
        stage: 'review',
        stageChanges: [{ stage: 'review', states: ['AS_IS', 'BROKEN'] }],
      },
    ],
    transitionVersion: 1,
  };
}

function metric(label: string) {
  return {
    description: '',
    label,
    maximumDescription: '',
    maximumLabel: '',
    minimumDescription: '',
    minimumLabel: '',
  };
}

function metricDefinitions() {
  return {
    controllability: metric('Предсказуемость'),
    deliverySpeed: metric('TTM'),
    quality: metric('Качество'),
    teamCapacity: metric('Run / Change'),
  };
}

function choice(label: string, index: number): ActionBallotChoice {
  return {
    description: `Описание ${label}.`,
    evidence: 'SCENARIO',
    id: `action-${index}`,
    key: String(index),
    kind: 'ACTION',
    repeatable: true,
    shortFeedback: `Разбор ${label}.`,
    stage: 'review',
    title: `Решение ${index + 1}`,
  };
}
