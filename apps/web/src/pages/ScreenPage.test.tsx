import type { GameState, MetricDefinition } from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { StageMap } from '../components/StageMap';
import { ScreenEntry, ScreenGameView } from './ScreenPage';

beforeAll(() => {
  vi.stubGlobal('window', {
    location: { origin: 'https://game.example', pathname: '/' },
  });
});

afterAll(() => vi.unstubAllGlobals());

describe('ScreenEntry', () => {
  it('показывает вход без общей шапки', () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <ScreenEntry onSubmit={() => undefined} />
      </MemoryRouter>,
    );
    expect(html).toContain('Общий экран');
    expect(html).not.toContain('class="topbar"');
  });
});

describe('ScreenGameView', () => {
  it('всегда показывает текущий шаг, метрики, состояние SDLC и QR', () => {
    const html = render(state({ currentBallot: stageBallot, phase: 'VOTING' }));
    expect(html).toContain('Идёт голосование');
    expect(html).toContain('aria-label="Метрики SDLC"');
    expect(html).toContain('Состояние SDLC');
    expect(html).toContain('Войти в игру');
    expect(html).toContain('ABCDE');
    expect(html).not.toContain('class="metric-description"');
    expect(html).not.toContain('0 — исходный процесс');
    expect(html).not.toContain('История решений');
    expect(html).not.toContain('Карта SDLC');
    expect(html).not.toContain('AI SDLC RPG');
    expect(html).not.toContain('Экран зала');
    expect(html).not.toContain('В сети');
    expect(html.match(/Состояние SDLC/g)).toHaveLength(1);
    expectInDashboardOrder(html);
  });

  it('во время события показывает только название фазы', () => {
    const html = render(
      state({ currentBallot: actionBallot, currentRound: eventRound, phase: 'EVENT' }),
    );
    expect(html).toContain('Событие хода');
    expect(html).not.toContain('Проверить код с AI');
    expect(html).not.toContain('Ревью не успевает за кодом');
    expect(html).not.toContain('Изменения ждут проверки дольше, чем раньше.');
    expect(html).not.toContain('Старое решение');
    expect(html).not.toContain('Скрытая активация для ведущего');
    expect(html).not.toContain('Скрытая подсказка для ведущего');
  });

  it('не уточняет вид голосования внутри общей фазы', () => {
    const stageVoting = render(state({ currentBallot: stageBallot, phase: 'VOTING' }));
    const actionVoting = render(state({ currentBallot: actionBallot, phase: 'VOTING' }));
    const stageResult = render(
      state({ currentBallot: { ...stageBallot, selectedChoiceId: 'review' }, phase: 'RESULT' }),
    );
    const actionResult = render(state({ currentBallot: actionBallot, phase: 'RESULT' }));
    expect(stageVoting).toContain('Идёт голосование');
    expect(actionVoting).toContain('Идёт голосование');
    expect(stageResult).toContain('Голосование завершено');
    expect(actionResult).toContain('Голосование завершено');
    expect(stageVoting).not.toContain('Выбираем этап');
    expect(actionVoting).not.toContain('Проверить код с AI');
    expect(actionResult).not.toContain('Проверить код с AI');
  });

  it('в итоговой карте отделяет рабочее AI-решение от последней доработки', () => {
    const reviewProgress = {
      activeAiAction: {
        actionId: 'review.ai',
        roundNumber: 1,
        stage: 'review' as const,
        title: 'Проверять риски с AI',
      },
      appliedActions: [
        {
          actionId: 'review.ai',
          roundNumber: 1,
          stage: 'review' as const,
          title: 'Проверять риски с AI',
        },
        {
          actionId: 'review.rules',
          roundNumber: 5,
          stage: 'review' as const,
          title: 'Записать правила ревью',
        },
      ],
      state: 'AI_ENABLED' as const,
    };
    const html = renderToStaticMarkup(
      <StageMap
        state={state({ phase: 'WON', stageProgress: { ...stageProgress, review: reviewProgress } })}
      />,
    );
    expect(html).toContain('AI-решение');
    expect(html).toContain('Проверять риски с AI');
    expect(html).toContain('Последнее решение на этапе');
    expect(html).toContain('Записать правила ревью');
  });
});

function render(gameState: GameState) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <ScreenGameView code="ABCDE" state={gameState} />
    </MemoryRouter>,
  );
}

function expectInDashboardOrder(html: string) {
  const decision = html.indexOf('Текущая фаза');
  const metrics = html.indexOf('aria-label="Метрики SDLC"');
  const stages = html.indexOf('Состояние SDLC');
  const qr = html.indexOf('Войти в игру');
  expect(decision).toBeLessThan(metrics);
  expect(metrics).toBeLessThan(stages);
  expect(stages).toBeLessThan(qr);
}

function state(overrides: Partial<GameState> = {}): GameState {
  return { ...baseState, ...overrides };
}

function definition(label: string): MetricDefinition {
  return {
    description: `${label}: длинное пояснение`,
    label,
    maximumDescription: 'Всё хорошо.',
    maximumLabel: 'Хорошо',
    minimumDescription: 'Всё плохо.',
    minimumLabel: 'Плохо',
  };
}

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
  id: 'stage-ballot',
  kind: 'STAGE',
  selectedChoiceId: null,
  stage: null,
  tiedChoiceIds: [],
  voteTallies: [{ choiceId: 'review', count: 0, share: 0 }],
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
      shortFeedback: null,
      stage: 'review',
      title: 'Проверить код с AI',
    },
  ],
  id: 'action-ballot',
  kind: 'ACTION',
  selectedChoiceId: 'review-with-ai',
  stage: 'review',
  tiedChoiceIds: [],
  voteTallies: [{ choiceId: 'review-with-ai', count: 3, share: 1 }],
};

const eventRound: NonNullable<GameState['currentRound']> = {
  activatedActions: [
    {
      actionId: 'review-with-ai',
      completedByActionId: 'review-rules',
      completedByTitle: 'Добавить правила ревью',
      stage: 'review',
      title: 'Скрытая активация для ведущего',
    },
  ],
  effectBreakdown: null,
  event: {
    description: 'Изменения ждут проверки дольше, чем раньше.',
    evidence: 'SCENARIO',
    id: 'review-queue',
    title: 'Ревью не успевает за кодом',
  },
  id: 'round-1',
  metricImpact: 'WORSENED',
  number: 1,
  options: [],
  recovery: {
    hostHint: 'Скрытая подсказка для ведущего',
    prerequisiteActions: [],
    repairActions: [],
  },
  selectedOptionId: 'review-with-ai',
  situation: 'Код стал появляться быстрее.',
  tiedOptionIds: [],
  title: 'Очередь на ревью',
  voteTallies: [{ count: 3, optionId: 'review-with-ai', share: 1 }],
};

const stageProgress: GameState['stageProgress'] = {
  businessRequest: { appliedActions: [], state: 'AS_IS' },
  coding: { appliedActions: [], state: 'AS_IS' },
  deployment: { appliedActions: [], state: 'AS_IS' },
  productDiscovery: { appliedActions: [], state: 'AS_IS' },
  review: {
    appliedActions: [{ actionId: 'old', roundNumber: 1, stage: 'review', title: 'Старое решение' }],
    state: 'AI_ENABLED',
  },
  support: { appliedActions: [], state: 'AS_IS' },
  technicalDiscovery: { appliedActions: [], state: 'AS_IS' },
  testing: { appliedActions: [], state: 'BROKEN' },
};

const baseState: GameState = {
  allowedCommands: [],
  code: 'ABCDE',
  currentBallot: null,
  currentRound: null,
  decisionModel: 'STAGE_ACTION_V2',
  metricBounds: { maximum: 10, minimum: -10 },
  metricDefinitions: {
    controllability: definition('Предсказуемость результата'),
    deliverySpeed: definition('TTM'),
    quality: definition('Качество и стабильность'),
    teamCapacity: definition('Баланс Run / Change'),
  },
  metricScaleDescription: '0 — исходный процесс · минус — хуже · плюс — лучше',
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
  stageProgress,
  stages: {
    businessRequest: 'AS_IS',
    coding: 'AS_IS',
    deployment: 'AS_IS',
    productDiscovery: 'AS_IS',
    review: 'AI_ENABLED',
    support: 'AS_IS',
    technicalDiscovery: 'AS_IS',
    testing: 'BROKEN',
  },
  transitionVersion: 1,
  voteCount: 0,
};
