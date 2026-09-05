import type {
  ActionBallotChoice,
  ActionPotentialView,
  AdminForecast,
  ForecastCountScopeView,
  ForecastPredicateView,
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
  expect(html).toContain('Что нужно, чтобы AI заработал');
  expect(html).toContain('Что нужно для роста метрик');
  expect(html).toContain('Автоматические тесты');
  expect(html).toContain('Правила ревью');
  expect(html).toContain('TTM: этап «Ревью» работает');
  expect(html).toContain('Может ухудшить');
  expect(html).toContain('Код готов, а ревью не успело');
  expect(html).toContain('Сработает сейчас');
  expect(html).toContain('Команда ещё не применяла ни одного решения из списка: Правила ревью');
  expect(html).toContain('>Выполнено<');
  expect(html).toContain('>Не выполнено<');
  expect(html).toContain('is-active');
  expect(html).toContain('is-inactive');
});

it('отделяет подготовку AI от условий роста метрик', () => {
  const html = renderToStaticMarkup(
    <BallotFocus forecast={actionForecast()} state={resultState()} />,
  );
  const activation = html
    .split('<h4>Что нужно, чтобы AI заработал</h4>')[1]
    ?.split('</section>')[0];
  const metrics = html.split('<h4>Что нужно для роста метрик</h4>')[1]?.split('</section>')[0];
  expect(activation).toContain('Автоматические тесты');
  expect(activation).not.toContain('TTM: этап «Ревью» работает');
  expect(metrics).toContain('TTM: этап «Ревью» работает');
  expect(metrics).not.toContain('Автоматические тесты');
});

it.each([
  ['activationRequirements', 'Что нужно, чтобы AI заработал'],
  ['positiveEffectRequirements', 'Что нужно для роста метрик'],
] as const)('скрывает заголовок пустого списка %s', (field, title) => {
  const forecast = actionForecast();
  const potential = forecast.actionPotentials[0];
  if (!potential) throw new Error('В тесте нет прогноза действия');
  potential[field] = [];
  const html = renderToStaticMarkup(<BallotFocus forecast={forecast} state={resultState()} />);
  expect(html).not.toContain(title);
});

it('объясняет условие о ранее применённых решениях', () => {
  const html = renderCondition({
    actionIds: ['testing.behavior-checks', 'review.risk-policy'],
    expected: 'APPLIED',
    kind: 'ACTION_HISTORY',
    satisfied: true,
    titles: ['Автоматические тесты', 'Правила ревью'],
  });
  expect(html).toContain(
    'Команда уже применила все решения из списка: Автоматические тесты; Правила ревью',
  );
});

const repetitionCases: [number | undefined, number | undefined, string][] = [
  [0, 0, '0 раз'],
  [1, 1, '1 раз'],
  [2, 2, '2 раза'],
  [5, 5, '5 раз'],
  [11, 11, '11 раз'],
  [12, 12, '12 раз'],
  [21, 21, '21 раз'],
  [22, 22, '22 раза'],
  [111, 111, '111 раз'],
  [112, 112, '112 раз'],
  [1, undefined, 'не меньше 1 раза'],
  [2, undefined, 'не меньше 2 раз'],
  [21, undefined, 'не меньше 21 раза'],
  [undefined, 1, 'не больше 1 раза'],
  [undefined, 2, 'не больше 2 раз'],
  [undefined, 21, 'не больше 21 раза'],
  [0, 1, 'от 0 до 1 раза'],
  [1, 2, 'от 1 до 2 раз'],
  [1, 11, 'от 1 до 11 раз'],
  [1, 21, 'от 1 до 21 раза'],
  [undefined, undefined, 'любое число раз'],
];

it.each(repetitionCases)('показывает число применений от %s до %s как «%s»', (min, max, range) => {
  const html = renderCondition(countCondition(min, max));
  expect(html).toContain(
    `Решения из списка применили суммарно ${range}: Автоматические тесты; Правила ревью`,
  );
});

it.each([true, false])('сохраняет начало периода при sinceStageSeen=%s', (sinceStageSeen) => {
  const scope: ForecastCountScopeView = {
    actionIds: ['review.risk-policy'],
    kind: 'STAGE_SINCE_LAST',
    sinceStage: 'testing',
    sinceStageSeen,
    stage: 'review',
    titles: ['Правила ревью'],
  };
  const html = renderCondition(countCondition(2, 2, scope));
  const period = sinceStageSeen
    ? 'После последнего решения на этапе «Тестирование»'
    : 'С начала игры';
  expect(html).toContain(`${period} решения из списка применили суммарно 2 раза: Правила ревью`);
  expect(html).toContain('Выполнено · сейчас 2');
});

it('подписывает число решений на этапе и сохраняет невыполненное условие', () => {
  const condition = countCondition(2, undefined, { kind: 'STAGE', stage: 'review' });
  condition.actual = 1;
  condition.satisfied = false;
  const html = renderCondition(condition);
  expect(html).toContain('На этапе «Ревью» принято решений: не меньше 2');
  expect(html).toContain('Не выполнено · сейчас 1');
});

function countCondition(
  minimum?: number,
  maximum?: number,
  scope: ForecastCountScopeView = {
    actionIds: ['testing.behavior-checks', 'review.risk-policy'],
    kind: 'ACTIONS',
    titles: ['Автоматические тесты', 'Правила ревью'],
  },
): Extract<ForecastPredicateView, { kind: 'COUNT' }> {
  return {
    actual: minimum ?? maximum ?? 0,
    kind: 'COUNT',
    maximum,
    minimum,
    satisfied: true,
    scope,
  };
}

function renderCondition(condition: ForecastPredicateView) {
  const forecast = actionForecast();
  const branch = forecast.actionPotentials[0]?.eventBranches[0];
  if (!branch) throw new Error('В тесте нет прогноза события');
  branch.conditions = [condition];
  return renderToStaticMarkup(<BallotFocus forecast={forecast} state={resultState()} />);
}

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
