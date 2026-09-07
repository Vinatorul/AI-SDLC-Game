import type { AdminForecast, GameState, RoundView } from '@ai-sdlc/contracts';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import harborSource from '../../../content/scenarios/harbor-example.json';
import { parseScenario } from '../../../packages/game-engine/src/scenario-schema';
import { App } from './App';
import { ActivatedActions } from './components/ActivatedActions';
import { ActionPotential } from './components/AdminPotential';
import { BallotFocus } from './components/BallotFocus';
import { FinalState } from './components/GameFocus';
import { Layout } from './components/Layout';
import { MetricBoard } from './components/MetricBoard';
import { MetricChangeNotes } from './components/MetricChangeNotes';
import { RecoveryGuides } from './components/RecoveryGuides';
import { AppliedHistory, StageMap } from './components/StageMap';
import { LandingPage } from './pages/LandingPage';
import { PlayerGameView } from './pages/PlayerPage';
import { ScreenGameView } from './pages/ScreenPage';
import { legacyPresentation, PresentationProvider, RoomPresentation } from './presentation';

const harbor = parseScenario(harborSource);
afterEach(() => vi.unstubAllGlobals());

it('до загрузки активного сценария не показывает старый сеттинг и создание комнаты', () => {
  const html = render(<App />);
  expect(html).toContain('Загружаем игру…');
  expect(html).not.toContain('AI');
  expect(html).not.toContain('Создать игру');
});

it('берёт название и вступление активного сценария до входа в комнату', () => {
  const html = render(
    <PresentationProvider presentation={harbor.presentation}>
      <LandingPage />
      <Layout>Пульт ведущего</Layout>
    </PresentationProvider>,
  );
  expect(html).toContain(harbor.presentation.branding.title);
  expect(html).toContain(harbor.presentation.branding.heading);
  expect(html).toContain(harbor.presentation.branding.description);
  expect(html).not.toContain('SDLC');
});

it('в комнате использует сохранённое название, а в старой комнате явный fallback', () => {
  const oldRoom = state();
  delete oldRoom.presentation;
  const html = render(
    <PresentationProvider presentation={harbor.presentation}>
      <RoomPresentation state={oldRoom}>
        <Layout>Комната</Layout>
      </RoomPresentation>
    </PresentationProvider>,
  );
  expect(html).toContain(legacyPresentation.branding.title);
  expect(html).not.toContain(harbor.presentation.branding.title);
  const saved = render(
    <PresentationProvider presentation={legacyPresentation}>
      <RoomPresentation state={state()}>
        <Layout>Комната</Layout>
      </RoomPresentation>
    </PresentationProvider>,
  );
  expect(saved).toContain(harbor.presentation.branding.title);
  expect(saved).not.toContain(legacyPresentation.branding.title);
});

it('показывает только три метрики и три участка другого сценария на общем экране', () => {
  vi.stubGlobal('window', { location: { origin: 'https://game.example', pathname: '/' } });
  const html = render(<ScreenGameView code="PORT23" state={state()} />);
  expect(html.match(/class="metric-card /g)).toHaveLength(3);
  expect(html.match(/class="stage-card /g)).toHaveLength(3);
  expect(html).toContain('aria-label="Состояние порта"');
  expect(html).toContain('Участки порта');
  expect(html).toContain('Готово к шторму');
  expect(html).toContain('--columns-four:3');
  expect(html.indexOf('Готовность порта:')).toBeLessThan(html.indexOf('Запасы:'));
  expect(html).not.toContain('SDLC');
  expect(html).not.toContain('AI');
});

it('сохраняет порядок каталога метрик и подстраивает сетку под одну метрику', () => {
  const presentation = { ...harbor.presentation, metricOrder: ['safety'] };
  const html = render(<MetricBoard state={state({ presentation })} />);
  expect(html.match(/class="metric-card /g)).toHaveLength(1);
  expect(html).toContain('Безопасность');
  expect(html).toContain('--columns-four:1');
  expect(html).not.toContain('Готовность порта');
});

it('показывает игроку новые этапы и состояния без отдельного provider в тесте', () => {
  const game = state({ currentBallot: stageBallot(), phase: 'VOTING' });
  const html = render(<PlayerGameView error={null} onVote={async () => undefined} state={game} />);
  expect(html).toContain('Выберите участок порта');
  expect(html).toContain('Причал');
  expect(html).toContain('Готово к шторму');
  expect(html.match(/class="stage-card /g)).toHaveLength(3);
  expect(html).not.toContain('Написание кода');
  expect(html).not.toContain('AI');
});

it('берёт заголовок и подписи этапов для ведущего из каталога комнаты', () => {
  const game = state({
    currentBallot: stageBallot(),
    currentRound: { ...round(), title: 'Выберите участок порта' },
    phase: 'VOTING',
  });
  const html = render(<BallotFocus state={game} />);
  expect(html).toContain('Выберите участок порта');
  expect(html).toContain('03');
  expect(html).toContain('Флот');
  expect(html).not.toContain('SDLC');
});

it('показывает новые свойства и метрики в истории и разборе причин', () => {
  const game = state({
    appliedActionHistory: [appliedAction],
    currentRound: round(),
    properties: ['spares'],
  });
  const html = render(
    <>
      <AppliedHistory state={game} />
      <MetricChangeNotes state={game} />
    </>,
  );
  expect(html).toContain('Запасные детали');
  expect(html).toContain('Флот · Подготовить буксиры');
  expect(html).toContain('Готовность порта +1');
  expect(html).toContain('Причал: Требуется ремонт');
  expect(html).toContain('Безопасность');
  expect(html).not.toContain('SDLC');
});

it('подставляет тексты активации и названия этапов в подсказках ведущему', () => {
  const game = state({ currentRound: round() });
  const html = render(
    <>
      <ActivatedActions state={game} />
      <RecoveryGuides state={game} />
    </>,
  );
  expect(html).toContain('После «Привезти детали» удалось завершить работу «Подготовить буксиры».');
  expect(html).toContain('участок «Причал» требует ремонта');
  expect(html).toContain('Склад');
  expect(html).not.toContain('AI');
});

it('использует динамические метрики, этапы, свойства и заголовок условий в прогнозе', () => {
  const html = render(
    <ActionPotential actionId="fleet.refit" forecast={forecast} state={state()} />,
  );
  expect(html).toContain('Готовность порта +1');
  expect(html).toContain('Флот → Готово к шторму');
  expect(html).toContain('Что нужно для подготовки');
  expect(html).toContain('Запасные детали');
  expect(html).not.toContain('AI');
});

it('берёт итог игры и карту победы из сохранённого сценария', () => {
  const game = state({ phase: 'WON' });
  const html = render(
    <>
      <FinalState state={game} />
      <StageMap state={game} />
    </>,
  );
  expect(html).toContain(harbor.presentation.copy.victoryText);
  expect(html).toContain('Порт готов к шторму');
  expect(html).not.toContain('AI');
  const lost = render(
    <FinalState state={state({ outcomeReason: 'AI_NOT_EMBEDDED', phase: 'BROKEN' })} />,
  );
  expect(lost).toContain('Порт не успели подготовить к шторму.');
});

function render(node: ReactNode) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

function state(overrides: Partial<GameState> = {}): GameState {
  return { ...baseState, ...overrides };
}

function stageBallot(): NonNullable<GameState['currentBallot']> {
  return {
    choices: harbor.presentation.stages.map(({ id, label }) => ({
      description: 'Подготовка участка',
      id,
      kind: 'STAGE',
      stage: id,
      title: label,
    })),
    id: 'harbor-stage',
    kind: 'STAGE',
    selectedChoiceId: null,
    stage: null,
    tiedChoiceIds: [],
    voteTallies: [],
  };
}

function round(): RoundView {
  return { ...baseRound, activatedActions: [activation], blockedActivations: [blockedActivation] };
}

const baseState: GameState = {
  allowedCommands: [],
  code: 'PORT23',
  currentBallot: null,
  currentRound: null,
  decisionModel: 'STAGE_ACTION_V2',
  metricBounds: harbor.mechanics.metricBounds,
  metricDefinitions: harbor.mechanics.metricDefinitions,
  metricScaleDescription: harbor.mechanics.metricScaleDescription,
  metrics: harbor.mechanics.initialMetrics,
  myVoteChoiceId: null,
  myVoteOptionId: null,
  outcomeReason: null,
  phase: 'LOBBY',
  playerCount: 3,
  presentation: harbor.presentation,
  properties: [],
  revision: 1,
  roundIndex: 0,
  rules: harbor.rules,
  stageProgress: {},
  stages: { ...harbor.mechanics.initialStages, pier: 'AI_ENABLED' },
  transitionVersion: 1,
  voteCount: 0,
};

const appliedAction = {
  actionId: 'fleet.refit',
  roundNumber: 1,
  stage: 'fleet',
  title: 'Подготовить буксиры',
  impact: {
    metricDelta: { readiness: 1 },
    reasons: { readiness: ['Механики проверили буксиры.'] },
  },
};
const activation = {
  actionId: 'fleet.refit',
  completedByActionId: 'warehouse.stock',
  completedByTitle: 'Привезти детали',
  stage: 'fleet',
  title: 'Подготовить буксиры',
};
const blockedActivation = { ...activation, reason: 'STAGE_BROKEN' as const, stage: 'pier' };
const baseRound: RoundView = {
  effectBreakdown: {
    decision: {},
    event: {},
    properties: { reserves: 1 },
    total: { reserves: 1, safety: -1 },
  },
  effectContributions: [
    {
      effect: { reserves: 1 },
      effectReasons: { reserves: 'Привезли детали.' },
      kind: 'PROPERTY',
      property: 'spares',
    },
    {
      effect: { safety: -1 },
      effectReasons: { safety: 'Крепления повреждены.' },
      kind: 'STAGE_STATE',
      stage: 'pier',
      state: 'BROKEN',
    },
  ],
  event: null,
  id: 'prepare-port',
  metricImpact: null,
  number: 1,
  options: [],
  recovery: {
    hostHint: 'Привезите детали.',
    prerequisiteActions: [
      { actionId: 'warehouse.stock', stage: 'warehouse', title: 'Привезти детали' },
    ],
    repairActions: [],
  },
  selectedOptionId: null,
  situation: 'Шторм приближается.',
  tiedOptionIds: [],
  title: 'Подготовка порта',
  voteTallies: [],
};

const forecast: AdminForecast = {
  actionPotentials: [
    {
      actionId: 'fleet.refit',
      metricDelta: { readiness: 1 },
      stageChanges: [{ stage: 'fleet', state: 'AI_ENABLED' }],
      activationRequirements: [
        { actionId: 'warehouse.stock', satisfied: false, title: 'Привезти детали' },
      ],
      positiveEffectRequirements: [],
      eventBranches: [
        {
          eventId: 'needs-spares',
          title: 'Механики ждут детали',
          influence: 'WORSENS',
          matched: true,
          selected: true,
          conditions: [
            {
              expected: 'ABSENT',
              kind: 'PROPERTY',
              property: 'spares',
              satisfied: true,
              timing: 'BEFORE_ACTION',
            },
          ],
        },
      ],
    },
  ],
  ballotId: 'harbor-action',
  kind: 'ACTION',
  revision: 1,
  stagePotentials: [],
  transitionVersion: 1,
};
