import type {
  AppliedActionView,
  GameState,
  MetricDefinition,
  MetricImpact,
  RoundView,
} from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OptionGrid } from '../components/OptionGrid';
import { PlayerGameView } from './PlayerPage';

describe('PlayerGameView', () => {
  it('в ожидании показывает только статус и метрики', () => {
    const html = render(state());
    expect(html).toContain('Голосование не идёт');
    expect(html).toContain('TTM');
    expect(html).not.toContain('AI SDLC');
    expect(html).not.toContain('Карта SDLC');
    expect(html).not.toContain('class="metric-description"');
    expect(html).not.toContain('0 — исходный процесс');
  });

  it('во время голосования оставляет только бюллетень без букв', () => {
    const html = render(state({ currentBallot: actionBallot, phase: 'VOTING' }));
    expect(html).toContain('Что сделаем?');
    expect(html).not.toContain('Что сделаем на этапе');
    expect(html).toContain('Проверить код с AI');
    expect(html).not.toContain('Ход 1');
    expect(html).not.toContain('Выбранный этап');
    expect(html).not.toContain('Выберите, что команда сделает');
    expect(html).not.toContain('aria-label="Метрики SDLC"');
    expect(html).not.toContain('option-key');
    expect(html).not.toMatch(/>A<\/span>/);
    expect(html).not.toContain('Если выберут сейчас');
  });

  it('не подменяет отсутствующий V2-бюллетень старым голосованием', () => {
    const html = render(state({ phase: 'VOTING' }));
    expect(html).toContain('Загружаем варианты…');
    expect(html).not.toContain('Старый вариант');
    expect(html).not.toContain('aria-label="Метрики SDLC"');
  });

  it('между голосованиями показывает цифры на тех же карточках', () => {
    const stageResult = {
      ...stageBallot,
      choices: [...stageBallot.choices, testingChoice],
      voteTallies: [
        { choiceId: 'review', count: 2, share: 2 / 3 },
        { choiceId: 'testing', count: 1, share: 1 / 3 },
      ],
    };
    const selectedAction = {
      ...actionBallot,
      selectedChoiceId: 'review-with-ai',
      voteTallies: [{ choiceId: 'review-with-ai', count: 3, share: 1 }],
    };
    const stageHtml = render(state({ currentBallot: stageResult, phase: 'RESULT' }));
    const actionHtml = render(state({ currentBallot: selectedAction, phase: 'RESULT' }));
    expect(stageHtml).toContain('Ревью');
    expect(stageHtml).toContain('Итоги голосования');
    expect(stageHtml).toContain('is-winner');
    expect(stageHtml).toContain('class="stage-votes">2</b>');
    expect(actionHtml).toContain('Проверить код с AI');
    expect(actionHtml).toContain('is-winner');
    expect(actionHtml).toContain('class="option-votes">3</b>');
    expect(actionHtml).not.toContain('AI быстро нашёл расхождения');
    expect(stageHtml).not.toContain('голоса ·');
    expect(stageHtml).not.toContain('player-vote-tallies');
    expect(stageHtml).not.toContain('aria-label="Метрики SDLC"');
    expect(actionHtml).not.toContain('aria-label="Метрики SDLC"');
  });

  it('при ничьей показывает лидеров до выбора ведущего', () => {
    const ballot = {
      ...stageBallot,
      choices: [...stageBallot.choices, testingChoice],
      selectedChoiceId: null,
      tiedChoiceIds: ['review', 'testing'],
      voteTallies: [
        { choiceId: 'review', count: 1, share: 0.5 },
        { choiceId: 'testing', count: 1, share: 0.5 },
      ],
    };
    const html = render(state({ currentBallot: ballot, phase: 'RESULT' }));
    expect(html).toContain('Ничья');
    expect(html).toContain('Ревью');
    expect(html).toContain('Тестирование');
    expect(html.match(/is-tied/g)).toHaveLength(2);
    expect(html.match(/class="stage-votes">1<\/b>/g)).toHaveLength(2);
    expect(html).toContain('Ведущий выберет один из лидеров.');
  });

  it('выбор этапа оставляет короткий вопрос, кубики и историю снизу', () => {
    const html = render(
      state({
        currentBallot: { ...stageBallot, selectedChoiceId: null },
        phase: 'VOTING',
        stageProgress: progressWithHistory,
      }),
    );
    expect(html).toContain('Выберите этап SDLC');
    expect(html).toContain('История решений');
    expect(html).toContain('Проверить код с AI');
    expect(html).not.toContain('Код стал появляться быстрее.');
    expect(html).not.toContain('1. Выбираем этап');
  });

  it('показывает историю решений снизу и при выборе действия', () => {
    const html = render(
      state({ currentBallot: actionBallot, phase: 'VOTING', stageProgress: progressWithHistory }),
    );
    expect(html).toContain('История решений');
    expect(html).toContain('Проверить код с AI');
    expect(html.indexOf('История решений')).toBeGreaterThan(html.indexOf('Что сделаем?'));
  });

  it('в истории ставит свежий ход выше и объясняет изменение метрик', () => {
    const html = render(
      state({
        appliedActionHistory: [
          historyAction(2, 'Сначала проверить риск', -1, 'Проверка задержала релиз.', {
            delta: 2,
            reason: 'Автотесты поймали баг до слияния.',
          }),
          historyAction(1, 'Собрать контекст', 1, 'Команда быстрее нашла нужные данные.'),
        ],
      }),
    );
    expect(html.indexOf('Сначала проверить риск')).toBeLessThan(html.indexOf('Собрать контекст'));
    expect(html).toMatch(/TTM -1<\/span><p>Проверка задержала релиз\.<\/p>/);
    expect(html).toMatch(
      /Качество и стабильность \+2<\/span><p>Автотесты поймали баг до слияния\.<\/p>/,
    );
    expect(html).toContain('Команда быстрее нашла нужные данные.');
  });

  it('после показа события скрывает служебные подписи и метрики', () => {
    const html = render(state({ currentRound: eventRound('WORSENED'), phase: 'EVENT' }));
    expect(html).toContain('Ревью не успевает за кодом');
    expect(html).toContain('event-worsened');
    expect(html).not.toContain('Игровой сценарий');
    expect(html).not.toContain('Метрики пока не изменились');
    expect(html).not.toContain('aria-label="Метрики SDLC"');
  });

  it.each([
    ['IMPROVED', 'event-improved'],
    ['WORSENED', 'event-worsened'],
    ['NEUTRAL', 'event-neutral'],
  ] as const)('задаёт событию цвет для результата %s', (impact, className) => {
    const html = render(state({ currentRound: eventRound(impact), phase: 'EVENT' }));
    expect(html).toContain(className);
  });

  it('после хода показывает событие и новые значения без объяснений', () => {
    const html = render(state({ currentRound: feedbackRound(), phase: 'FEEDBACK' }));
    expect(html).toContain('Ревью не успевает за кодом');
    expect(html).toContain('aria-label="Метрики SDLC"');
    expect(html).not.toContain('Откуда взялись баллы');
    expect(html).not.toContain('Очередь на ревью задержала релиз.');
    expect(html).not.toContain('Скрытая активация для ведущего');
    expect(html).not.toContain('Скрытая причина для ведущего');
    expect(html).not.toContain('Скрытая подсказка для ведущего');
    expect(html).not.toContain('Карта SDLC');
    expect(html).not.toContain('class="metric-description"');
    expect(html).not.toContain('0 — исходный процесс');
  });

  it('в финале показывает только итог игры', () => {
    const html = render(state({ phase: 'WON' }));
    expect(html).toContain('Победа');
    expect(html).not.toContain('aria-label="Метрики SDLC"');
    expect(html).not.toContain('Карта SDLC');
  });
});

describe('OptionGrid', () => {
  it('не показывает служебную букву старого варианта', () => {
    const html = renderToStaticMarkup(<OptionGrid round={baseRound} />);
    expect(html).toContain('Старый вариант');
    expect(html).not.toContain('option-key');
    expect(html).not.toMatch(/>A<\/span>/);
  });
});

function render(gameState: GameState) {
  return renderToStaticMarkup(
    <PlayerGameView error={null} onVote={() => undefined} state={gameState} />,
  );
}

function state(overrides: Partial<GameState> = {}): GameState {
  return { ...baseState, ...overrides };
}

function eventRound(metricImpact: MetricImpact): RoundView {
  return { ...baseRound, event, metricImpact };
}

function feedbackRound(): RoundView {
  return {
    ...eventRound('WORSENED'),
    activatedActions: [activation('Скрытая активация для ведущего')],
    blockedActivations: [
      {
        ...activation('Скрытая причина для ведущего'),
        reason: 'STAGE_BROKEN',
        recovery: hiddenRecovery,
      },
    ],
    effectBreakdown: {
      applied: { deliverySpeed: -1 },
      decision: {},
      event: { deliverySpeed: -1 },
      pipeline: {},
      properties: {},
      total: { deliverySpeed: -1 },
    },
    recovery: hiddenRecovery,
  };
}

const hiddenRecovery = {
  hostHint: 'Скрытая подсказка для ведущего',
  prerequisiteActions: [],
  repairActions: [],
};

function activation(title: string) {
  return {
    actionId: 'review-with-ai',
    completedByActionId: 'review-rules',
    completedByTitle: 'Добавить правила ревью',
    stage: 'review' as const,
    title,
  };
}

const baseRound: RoundView = {
  effectBreakdown: null,
  event: null,
  id: 'round-1',
  metricImpact: null,
  number: 1,
  options: [
    {
      description: 'Описание старого варианта.',
      evidence: 'SCENARIO',
      id: 'legacy-a',
      key: 'A',
      shortFeedback: null,
      stage: 'coding',
      title: 'Старый вариант',
    },
  ],
  selectedOptionId: null,
  situation: 'Код стал появляться быстрее.',
  tiedOptionIds: [],
  title: 'Очередь на ревью',
  voteTallies: [],
};

const event = {
  description: 'Изменения ждут проверки дольше, чем раньше.',
  evidence: 'SCENARIO' as const,
  id: 'review-queue',
  title: 'Ревью не успевает за кодом',
};

const actionBallot: NonNullable<GameState['currentBallot']> = {
  choices: [
    {
      description: 'AI отмечает рискованные места, решение принимает человек.',
      evidence: 'SCENARIO',
      id: 'review-with-ai',
      key: 'A',
      kind: 'ACTION',
      repeatable: true,
      shortFeedback: 'AI быстро нашёл расхождения, а инженер проверил каждое.',
      stage: 'review',
      title: 'Проверить код с AI',
    },
  ],
  id: 'ballot-1',
  kind: 'ACTION',
  selectedChoiceId: null,
  stage: 'review',
  tiedChoiceIds: [],
  voteTallies: [],
};

const stageBallot: NonNullable<GameState['currentBallot']> = {
  choices: [
    {
      description: 'Проверить изменения до релиза.',
      id: 'review',
      kind: 'STAGE',
      stage: 'review',
      title: 'Ревью',
    },
  ],
  id: 'stage-ballot-1',
  kind: 'STAGE',
  selectedChoiceId: 'review',
  stage: 'review',
  tiedChoiceIds: [],
  voteTallies: [],
};

const testingChoice = {
  description: 'Проверить основные сценарии.',
  id: 'testing' as const,
  kind: 'STAGE' as const,
  stage: 'testing' as const,
  title: 'Тестирование',
};

const baseStageProgress: GameState['stageProgress'] = {
  businessRequest: { appliedActions: [], state: 'AS_IS' },
  coding: { appliedActions: [], state: 'AS_IS' },
  deployment: { appliedActions: [], state: 'AS_IS' },
  productDiscovery: { appliedActions: [], state: 'AS_IS' },
  review: { appliedActions: [], state: 'AS_IS' },
  support: { appliedActions: [], state: 'AS_IS' },
  technicalDiscovery: { appliedActions: [], state: 'AS_IS' },
  testing: { appliedActions: [], state: 'AS_IS' },
};

const progressWithHistory: GameState['stageProgress'] = {
  ...baseStageProgress,
  review: {
    appliedActions: [
      {
        actionId: 'review-with-ai',
        roundNumber: 1,
        stage: 'review',
        title: 'Проверить код с AI',
      },
    ],
    state: 'AI_ENABLED',
  },
};

function historyAction(
  roundNumber: number,
  title: string,
  delta: number,
  reason: string,
  quality?: { delta: number; reason: string },
): AppliedActionView {
  return {
    actionId: `history-${roundNumber}`,
    impact: {
      metricDelta: { deliverySpeed: delta, ...(quality ? { quality: quality.delta } : {}) },
      reasons: {
        deliverySpeed: [reason],
        ...(quality ? { quality: [quality.reason] } : {}),
      },
    },
    roundNumber,
    stage: 'review' as const,
    title,
  };
}

const baseStages: GameState['stages'] = {
  businessRequest: 'AS_IS',
  coding: 'AS_IS',
  deployment: 'AS_IS',
  productDiscovery: 'AS_IS',
  review: 'AS_IS',
  support: 'AS_IS',
  technicalDiscovery: 'AS_IS',
  testing: 'AS_IS',
};

const baseState: GameState = {
  allowedCommands: [],
  code: 'ABCDE',
  currentBallot: null,
  currentRound: baseRound,
  decisionModel: 'STAGE_ACTION_V2',
  metricBounds: { maximum: 10, minimum: -10 },
  metricDefinitions: {
    controllability: definition('Предсказуемость результата'),
    deliverySpeed: definition('TTM'),
    quality: definition('Качество и стабильность'),
    teamCapacity: definition('Баланс Run / Change'),
  },
  metricScaleDescription: 'Чем выше балл, тем лучше.',
  metrics: { controllability: 0, deliverySpeed: 0, quality: 0, teamCapacity: 0 },
  myVoteChoiceId: null,
  myVoteOptionId: null,
  outcomeReason: null,
  phase: 'LOBBY',
  playerCount: 3,
  properties: [],
  revision: 1,
  roundIndex: 0,
  rules: {
    criticalThreshold: -8,
    dangerThreshold: -5,
    minAiStagesToWin: 8,
    notableVoteShare: 0.2,
    requireNoBrokenStages: true,
    roundLimit: 1,
  },
  stageProgress: baseStageProgress,
  stages: baseStages,
  transitionVersion: 1,
  voteCount: 0,
};

function definition(label: string): MetricDefinition {
  return {
    description: `${label}: описание`,
    label,
    maximumDescription: 'Всё хорошо.',
    maximumLabel: 'Хорошо',
    minimumDescription: 'Всё плохо.',
    minimumLabel: 'Плохо',
  };
}
