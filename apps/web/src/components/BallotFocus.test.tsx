import type { ActionBallotChoice, AdminForecast, GameState } from '@ai-sdlc/contracts';
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
    rules: { notableVoteShare: 0.2 },
    stageProgress: { review: { appliedActions: [], state: 'AS_IS' } },
  } as unknown as GameState;
}

function actionForecast(): AdminForecast {
  return {
    actionPotentials: [
      {
        actionId: 'action-0',
        metricDelta: { deliverySpeed: 2, quality: -1 },
        stageChanges: [{ stage: 'review', state: 'AI_ENABLED' }],
      },
    ],
    ballotId: 'action-ballot',
    kind: 'ACTION',
    revision: 1,
    stagePotentials: [],
    transitionVersion: 1,
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
