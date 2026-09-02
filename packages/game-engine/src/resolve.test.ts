import { type GameRules, type MetricDelta, stageKeys } from '@ai-sdlc/contracts';
import { describe, expect, it } from 'vitest';
import {
  createInitialMetrics,
  createInitialStages,
  evaluateOutcome,
  getAvailableActions,
  getAvailableStageChoices,
  getStageAction,
  resolveRound,
} from './resolve';
import { defaultScenario } from './scenario';
import type {
  EngineAction,
  EngineSnapshot,
  ScenarioMechanics,
  ScenarioRound,
  StageActionCatalog,
} from './types';

const mechanics: ScenarioMechanics = {
  initialMetrics: { controllability: 0, deliverySpeed: 0, quality: 0, teamCapacity: 0 },
  metricBounds: { maximum: 10, minimum: -10 },
  metricDefinitions: defaultScenario.mechanics.metricDefinitions,
  metricScaleDescription: 'Тестовая шкала',
  propertyEffects: {
    automatedTests: {},
    currentContext: {},
    humanReview: { quality: 1 },
    observability: {},
    rollback: {},
  },
};

const rules: GameRules = {
  criticalThreshold: -8,
  dangerThreshold: -5,
  minAiStagesToWin: 3,
  notableVoteShare: 0.15,
  requireNoBrokenStages: false,
  roundLimit: 5,
  roundMode: 'FINITE',
};

const action: EngineAction = {
  addProperties: ['humanReview'],
  availableInStates: ['AS_IS', 'AI_ENABLED', 'BROKEN'],
  description: 'Описание решения',
  effect: { deliverySpeed: 3 },
  effectReasons: { deliverySpeed: 'Код появился без ручного ожидания.' },
  evidence: 'SCENARIO',
  id: 'action-a',
  key: 'A',
  repeatable: false,
  resultingStageState: 'AI_ENABLED',
  shortFeedback: 'Обратная связь',
  stage: 'coding',
  title: 'Решение',
};

const testCatalog: StageActionCatalog = { [action.id]: action };

const round: ScenarioRound = {
  eventRules: [
    {
      actionIds: ['action-a'],
      event: {
        description: 'Описание события',
        effect: { quality: -2 },
        effectReasons: { quality: 'Ошибка дошла до следующего этапа.' },
        evidence: 'SCENARIO',
        id: 'event-selected',
        stageChanges: [{ stage: 'review', state: 'BROKEN' }],
        title: 'Событие',
      },
    },
    {
      event: {
        description: 'Резервное событие',
        effect: {},
        evidence: 'SCENARIO',
        id: 'event-fallback',
        stageChanges: [],
        title: 'Резерв',
      },
    },
  ],
  id: 'round-1',
  number: 1,
  situation: 'Ситуация',
  stageChoices: [
    { actionIds: ['action-a'], description: 'Описание этапа', stage: 'coding', title: 'Код' },
  ],
  title: 'Раунд',
};

const infrastructurePaths = [
  {
    actionId: 'businessRequest.feedback-mcp',
    badEventId: 'event-feedback-mcp-without-metrics',
    failedState: 'AS_IS',
    goodEventId: 'event-feedback-mcp-ready',
    setupActionIds: ['businessRequest.outcome-metrics'],
    stage: 'businessRequest',
  },
  {
    actionId: 'productDiscovery.knowledge-skill',
    badEventId: 'event-product-skill-without-base',
    failedState: 'BROKEN',
    goodEventId: 'event-product-skill-ready',
    setupActionIds: ['productDiscovery.knowledge-base'],
    stage: 'productDiscovery',
  },
  {
    actionId: 'technicalDiscovery.ai-impact-analysis',
    badEventId: 'event-impact-graph-missing',
    failedState: 'AS_IS',
    goodEventId: 'event-impact-graph-used',
    setupActionIds: ['technicalDiscovery.dependency-map'],
    stage: 'technicalDiscovery',
  },
  {
    actionId: 'coding.repository-mcp',
    badEventId: 'event-repository-mcp-without-context',
    failedState: 'BROKEN',
    goodEventId: 'event-repository-mcp-ready',
    setupActionIds: [
      'productDiscovery.requirement-draft',
      'testing.behavior-checks',
      'coding.project-checks',
    ],
    stage: 'coding',
  },
  {
    actionId: 'review.review-skill',
    badEventId: 'event-review-skill-without-policy',
    failedState: 'BROKEN',
    goodEventId: 'event-review-skill-ready',
    setupActionIds: ['review.risk-policy', 'testing.behavior-checks'],
    stage: 'review',
  },
  {
    actionId: 'testing.test-generation-skill',
    badEventId: 'event-test-skill-without-baseline',
    failedState: 'BROKEN',
    goodEventId: 'event-test-generation-skill-ready',
    setupActionIds: ['productDiscovery.knowledge-base', 'testing.behavior-checks'],
    stage: 'testing',
  },
  {
    actionId: 'deployment.autonomous-after-tests',
    badEventId: 'event-autonomous-release-without-tests',
    failedState: 'BROKEN',
    goodEventId: 'event-auto-release-completed',
    setupActionIds: [
      'testing.behavior-checks',
      'deployment.rollback-drill',
      'support.telemetry-baseline',
    ],
    stage: 'deployment',
  },
  {
    actionId: 'deployment.mcp-tooling',
    badEventId: 'event-deploy-mcp-without-tests',
    failedState: 'AS_IS',
    goodEventId: 'event-deploy-mcp-ready',
    setupActionIds: [
      'testing.behavior-checks',
      'deployment.rollback-drill',
      'support.telemetry-baseline',
    ],
    stage: 'deployment',
  },
  {
    actionId: 'support.incident-mcp',
    badEventId: 'event-incident-mcp-without-signals',
    failedState: 'AS_IS',
    goodEventId: 'event-incident-mcp-ready',
    setupActionIds: ['support.telemetry-baseline'],
    stage: 'support',
  },
] as const;

function createSnapshot(): EngineSnapshot {
  return {
    appliedActions: [],
    metrics: createInitialMetrics(mechanics),
    properties: [],
    stages: createInitialStages(),
  };
}

describe('resolveRound', () => {
  it('складывает эффекты, меняет карту и сохраняет действие', () => {
    const plan = resolveRound(createSnapshot(), round, action, mechanics, testCatalog);
    expect(plan.metrics).toMatchObject({ deliverySpeed: 3, quality: -1 });
    expect(plan.breakdown.applied).toMatchObject({ deliverySpeed: 3, quality: -1 });
    expect(plan.effectContributions).toEqual([
      {
        description: 'Обратная связь',
        effect: { deliverySpeed: 3 },
        effectReasons: { deliverySpeed: 'Код появился без ручного ожидания.' },
        kind: 'DECISION',
        title: 'Решение',
      },
      {
        description: 'Описание события',
        effect: { quality: -2 },
        effectReasons: { quality: 'Ошибка дошла до следующего этапа.' },
        kind: 'EVENT',
        title: 'Событие',
      },
      { effect: { quality: 1 }, kind: 'PROPERTY', property: 'humanReview' },
    ]);
    expect(plan.stages.coding).toBe('AI_ENABLED');
    expect(plan.stages.review).toBe('BROKEN');
    expect(plan.appliedActions).toEqual([
      { actionId: 'action-a', roundNumber: 1, stage: 'coding' },
    ]);
  });

  it('не даёт положительный эффект через сломанный этап', () => {
    const configured: ScenarioMechanics = {
      ...mechanics,
      positiveEffectRequirements: {
        additionalStages: {
          deliverySpeed: { coding: ['review'] },
          quality: { coding: ['review'] },
        },
        requireActionStage: true,
      },
    };
    const plan = resolveRound(createSnapshot(), round, action, configured, testCatalog);
    const contribution = plan.effectContributions.find(({ kind }) => kind === 'DECISION');
    expect(plan.breakdown.decision).toEqual({});
    expect(plan.breakdown.event).toEqual({ quality: -2 });
    expect(plan.metrics).toMatchObject({ deliverySpeed: 0, quality: -1 });
    expect(contribution).toMatchObject({
      blockedByStages: { deliverySpeed: ['review'] },
      blockedEffect: { deliverySpeed: 3 },
      effect: {},
    });
  });

  it('штрафует TTM за каждый сломанный этап после события', () => {
    const configured = withBrokenStageEffect({ deliverySpeed: -1 });
    const snapshot = createSnapshot();
    snapshot.stages.testing = 'BROKEN';
    const plan = resolveRound(snapshot, round, action, configured, testCatalog);
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: -2 });
    expect(plan.effectContributions.filter(({ kind }) => kind === 'STAGE_STATE')).toEqual([
      {
        effect: { deliverySpeed: -1 },
        kind: 'STAGE_STATE',
        stage: 'review',
        state: 'BROKEN',
      },
      {
        effect: { deliverySpeed: -1 },
        kind: 'STAGE_STATE',
        stage: 'testing',
        state: 'BROKEN',
      },
    ]);
    expect(plan.metrics.deliverySpeed).toBe(1);
  });

  it('перестаёт штрафовать за этап в тот же ход, когда его починили', () => {
    const configured = withBrokenStageEffect({ deliverySpeed: -1 });
    const snapshot = createSnapshot();
    snapshot.stages.coding = 'BROKEN';
    const fallbackRound = {
      ...round,
      eventRules: [round.eventRules[1] as (typeof round.eventRules)[number]],
    };
    const plan = resolveRound(snapshot, fallbackRound, action, configured, testCatalog);
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: 0 });
    expect(plan.metrics.deliverySpeed).toBe(3);
  });

  it('берёт показатель штрафа из сценария, а не предполагает TTM', () => {
    const configured = withBrokenStageEffect({ quality: -2 });
    const plan = resolveRound(createSnapshot(), round, action, configured, testCatalog);
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: 0, quality: -2 });
    expect(plan.metrics).toMatchObject({ deliverySpeed: 3, quality: -3 });
  });

  it('берёт границы и эффекты свойств из сценария', () => {
    const configured = {
      ...mechanics,
      metricBounds: { maximum: 2, minimum: -2 },
      propertyEffects: { ...mechanics.propertyEffects, humanReview: { quality: 5 } },
    };
    const plan = resolveRound(createSnapshot(), round, action, configured, testCatalog);
    expect(plan.metrics).toMatchObject({ deliverySpeed: 2, quality: 2 });
    expect(plan.breakdown.total).toMatchObject({ deliverySpeed: 3, quality: 3 });
    expect(plan.breakdown.applied).toMatchObject({ deliverySpeed: 2, quality: 2 });
  });

  it('проверяет условия события по состоянию до нового действия', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasProperty = 'humanReview';
    const plan = resolveRound(createSnapshot(), conditional, action, mechanics, testCatalog);
    expect(plan.event.id).toBe('event-fallback');
  });

  it('может учитывать свойство, которое добавляет текущее действие', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasResultingProperty = 'humanReview';
    const plan = resolveRound(createSnapshot(), conditional, action, mechanics, testCatalog);
    expect(plan.event.id).toBe('event-selected');
  });

  it('учитывает историю, состояния и число ходов по этапу', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasAppliedActions = ['test-baseline'];
    firstRule.appliedActionCounts = [{ actionIds: ['test-baseline'], minimum: 1 }];
    firstRule.appliedActionCount = { maximum: 1, minimum: 1 };
    firstRule.stageActionCounts = [{ maximum: 1, minimum: 1, stage: 'testing' }];
    firstRule.stageStates = [{ stage: 'coding', state: 'AS_IS' }];
    const snapshot = createSnapshot();
    snapshot.appliedActions = [{ actionId: 'test-baseline', roundNumber: 1, stage: 'testing' }];
    expect(resolveRound(snapshot, conditional, action, mechanics, testCatalog).event.id).toBe(
      'event-selected',
    );
  });

  it('не повторяет обычные эффекты у повторного действия без repeatEffect', () => {
    const repeated = { ...action, repeatable: true };
    const snapshot = createSnapshot();
    snapshot.appliedActions = [{ actionId: action.id, roundNumber: 1, stage: action.stage }];
    const plan = resolveRound(snapshot, round, repeated, mechanics, testCatalog);
    expect(plan.breakdown.decision).toEqual({});
    expect(plan.breakdown.event).toEqual({});
    expect(plan.effectContributions).toEqual([
      { effect: { quality: 1 }, kind: 'PROPERTY', property: 'humanReview' },
    ]);
  });

  it('берёт repeatEffect и причины при повторном действии', () => {
    const repeated = {
      ...action,
      repeatEffect: { quality: 1 },
      repeatEffectReasons: { quality: 'Второй проход нашёл ещё один дефект.' },
      repeatable: true,
    };
    const repeatedRound = structuredClone(round);
    const event = repeatedRound.eventRules[0]?.event;
    if (!event) throw new Error('Нет события для повторного действия');
    event.repeatEffect = { controllability: -1 };
    event.repeatEffectReasons = { controllability: 'Команда обошла прежнюю договорённость.' };
    const snapshot = createSnapshot();
    snapshot.appliedActions = [{ actionId: action.id, roundNumber: 1, stage: action.stage }];
    const plan = resolveRound(snapshot, repeatedRound, repeated, mechanics, testCatalog);
    expect(plan.breakdown).toMatchObject({
      decision: { quality: 1 },
      event: { controllability: -1 },
    });
    expect(plan.effectContributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ effectReasons: repeated.repeatEffectReasons, kind: 'DECISION' }),
        expect.objectContaining({ effectReasons: event.repeatEffectReasons, kind: 'EVENT' }),
      ]),
    );
  });

  it('применяет свойства действия, события и удаления в заданном порядке', () => {
    const propertyRound = structuredClone(round);
    const event = propertyRound.eventRules[0]?.event;
    if (!event) throw new Error('Нет события для свойств');
    event.addProperties = ['automatedTests', 'rollback'];
    event.removeProperties = ['humanReview'];
    const snapshot = createSnapshot();
    snapshot.properties = ['currentContext'];
    const plan = resolveRound(snapshot, propertyRound, action, mechanics, testCatalog);
    expect(plan.properties).toEqual(['currentContext', 'automatedTests', 'rollback']);
  });

  it('считает действия после последнего выбранного этапа', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.stageActionCountsSinceLast = [
      { minimum: 2, sinceStage: 'technicalDiscovery', stage: 'coding' },
    ];
    const snapshot = createSnapshot();
    snapshot.appliedActions = [
      { actionId: 'before', roundNumber: 1, stage: 'coding' },
      { actionId: 'marker', roundNumber: 2, stage: 'technicalDiscovery' },
      { actionId: 'after-1', roundNumber: 3, stage: 'coding' },
      { actionId: 'after-2', roundNumber: 4, stage: 'coding' },
    ];
    expect(resolveRound(snapshot, conditional, action, mechanics, testCatalog).event.id).toBe(
      'event-selected',
    );
    snapshot.appliedActions.pop();
    expect(resolveRound(snapshot, conditional, action, mechanics, testCatalog).event.id).toBe(
      'event-fallback',
    );
  });

  it('добавляет позднее последствие только после перекоса в кодинг', () => {
    const first = resolveScenarioAction(
      createScenarioSnapshot(),
      'coding.guided-implementation',
      1,
    );
    const second = resolveScenarioAction(
      snapshotFromPlan(first),
      'coding.guided-implementation',
      2,
    );
    expect(second.event.id).toBe('event-code-without-technical-context');
  });

  it('не добавляет позднее последствие после возврата в техническую проработку', () => {
    const first = resolveScenarioAction(
      createScenarioSnapshot(),
      'coding.guided-implementation',
      1,
    );
    const refreshed = resolveScenarioAction(
      snapshotFromPlan(first),
      'technicalDiscovery.sync-docs-and-contract',
      2,
    );
    const next = resolveScenarioAction(
      snapshotFromPlan(refreshed),
      'coding.guided-implementation',
      3,
    );
    expect(next.event.id).toBe('event-code-ready');
  });

  it('не начисляет обычные эффекты за повторные решения на рискованной ветке', () => {
    let snapshot = createScenarioSnapshot();
    const actionIds = [
      'review.risk-based-evidence',
      'review.context-and-human-risk',
      'review.context-and-human-risk',
      'review.context-and-human-risk',
    ];
    for (const [index, actionId] of actionIds.entries()) {
      const template = defaultScenario.rounds[0] as ScenarioRound;
      const current = { ...template, number: index + 1 };
      const action = getStageAction(defaultScenario.stageActions, actionId);
      snapshot = snapshotFromPlan(
        resolveRound(
          snapshot,
          current,
          action,
          defaultScenario.mechanics,
          defaultScenario.stageActions,
        ),
      );
    }
    expect(snapshot.metrics.deliverySpeed).toBe(-4);
  });

  it('ломает ревью и тестирование только после третьего изменения кода без подготовки', () => {
    const actionId = 'coding.guided-implementation';
    const first = resolveScenarioAction(createScenarioSnapshot(), actionId, 1);
    expectQueueStages(first, 'event-code-ready', 'AS_IS');
    const second = resolveScenarioAction(snapshotFromPlan(first), actionId, 2);
    expectQueueStages(second, 'event-code-without-technical-context', 'AS_IS');
    const overloaded = resolveScenarioAction(snapshotFromPlan(second), actionId, 3);
    expectQueueStages(overloaded, 'event-code-outpaces-review-and-tests', 'BROKEN');
    expect(overloaded.breakdown.pipeline).toMatchObject({ deliverySpeed: 0 });
    expect(overloaded.metrics.deliverySpeed).toBe(-2);
    expect(overloaded.event.effectReasons?.deliverySpeed).toContain('скопились очереди');
    const next = resolveScenarioAction(
      snapshotFromPlan(overloaded),
      'technicalDiscovery.sync-docs-and-contract',
      4,
    );
    expect(next.breakdown.pipeline).toMatchObject({ deliverySpeed: 0 });
    expect(next.metrics.deliverySpeed).toBe(overloaded.metrics.deliverySpeed);
  });

  it('не считает настройку проверок прошлым ускорением кодинга', () => {
    const template = defaultScenario.rounds[0] as ScenarioRound;
    const checks = getStageAction(defaultScenario.stageActions, 'coding.project-checks');
    const coding = getStageAction(defaultScenario.stageActions, 'coding.guided-implementation');
    const prepared = resolveRound(
      createScenarioSnapshot(),
      template,
      checks,
      defaultScenario.mechanics,
      defaultScenario.stageActions,
    );
    const plan = resolveRound(
      snapshotFromPlan(prepared),
      { ...template, number: 2 },
      coding,
      defaultScenario.mechanics,
      defaultScenario.stageActions,
    );
    expect(plan.event.id).toBe('event-code-ready');
    expect(plan.stages.review).toBe('AS_IS');
    expect(plan.stages.testing).toBe('AS_IS');
  });

  it('не ускоряет TTM перед сломанным этапом основного сценария', () => {
    const snapshot = createScenarioSnapshot();
    snapshot.stages.coding = 'BROKEN';
    const plan = resolveScenarioAction(snapshot, 'technicalDiscovery.code-research', 1);
    const contribution = plan.effectContributions.find(({ kind }) => kind === 'DECISION');
    expect(plan.breakdown.decision.deliverySpeed ?? 0).toBe(0);
    expect(plan.metrics.deliverySpeed).toBe(0);
    expect(contribution).toMatchObject({
      blockedByStages: { deliverySpeed: ['coding'] },
      blockedEffect: { deliverySpeed: 1 },
    });
  });

  it('не ускоряет TTM ни одним решением, которое сразу ломает процесс', () => {
    const template = defaultScenario.rounds[0] as ScenarioRound;
    for (const actionId of Object.keys(defaultScenario.stageActions)) {
      const selected = getStageAction(defaultScenario.stageActions, actionId);
      const plan = resolveRound(
        createScenarioSnapshot(),
        template,
        selected,
        defaultScenario.mechanics,
        defaultScenario.stageActions,
      );
      if (Object.values(plan.stages).includes('BROKEN')) {
        expect(plan.breakdown.total.deliverySpeed ?? 0, actionId).toBeLessThanOrEqual(0);
      }
    }
  });

  it('сохраняет зелёный этап при добавлении процессной основы', () => {
    const snapshot = createScenarioSnapshot();
    snapshot.stages.businessRequest = 'AI_ENABLED';
    const plan = resolveAvailableScenarioAction(snapshot, 'businessRequest.outcome-metrics', 1);
    expect(plan.stages.businessRequest).toBe('AI_ENABLED');
  });

  it('чинит сломанный этап процессной основой до серого', () => {
    const snapshot = createScenarioSnapshot();
    snapshot.stages.testing = 'BROKEN';
    const plan = resolveAvailableScenarioAction(snapshot, 'testing.behavior-checks', 1);
    expect(plan.stages.testing).toBe('AS_IS');
    expect(plan.breakdown.pipeline?.deliverySpeed ?? 0).toBe(0);
  });

  it('активирует уже установленный AI-контур после последней недостающей основы', () => {
    let plan = resolveAvailableScenarioAction(
      createScenarioSnapshot(),
      'businessRequest.feedback-mcp',
      1,
    );
    expect(plan.stages.businessRequest).toBe('AS_IS');
    plan = resolveAvailableScenarioAction(
      snapshotFromPlan(plan),
      'businessRequest.outcome-metrics',
      2,
    );
    expect(plan.stages.businessRequest).toBe('AI_ENABLED');
    expect(plan.activatedActions).toEqual([
      {
        actionId: 'businessRequest.feedback-mcp',
        completedByActionId: 'businessRequest.outcome-metrics',
        stage: 'businessRequest',
      },
    ]);
  });

  it('активирует несколько ранее установленных контуров одной основой', () => {
    const { catalog, selected } = createActivationSetup();
    const snapshot = createSnapshot();
    snapshot.appliedActions = [
      { actionId: 'review-ai', roundNumber: 1, stage: 'review' },
      { actionId: 'testing-ai', roundNumber: 2, stage: 'testing' },
    ];
    const plan = resolveRound(snapshot, fallbackOnlyRound(), selected, mechanics, catalog);
    expect(plan.activatedActions).toEqual([
      { actionId: 'review-ai', completedByActionId: 'foundation', stage: 'review' },
      { actionId: 'testing-ai', completedByActionId: 'foundation', stage: 'testing' },
    ]);
    expect(plan.stages.review).toBe('AI_ENABLED');
    expect(plan.stages.testing).toBe('AI_ENABLED');
  });

  it('не восстанавливает контур, который событие этого хода сломало', () => {
    const { catalog, selected } = createActivationSetup();
    const snapshot = createSnapshot();
    snapshot.appliedActions = [{ actionId: 'review-ai', roundNumber: 1, stage: 'review' }];
    const brokenRound = fallbackOnlyRound();
    const event = brokenRound.eventRules[0]?.event;
    if (!event) throw new Error('Нет события для сломанного контура');
    event.stageChanges = [{ stage: 'review', state: 'BROKEN' }];
    const plan = resolveRound(snapshot, brokenRound, selected, mechanics, catalog);
    expect(plan.activatedActions).toEqual([]);
    expect(plan.blockedActivations).toEqual([
      {
        actionId: 'review-ai',
        completedByActionId: 'foundation',
        reason: 'STAGE_BROKEN',
        stage: 'review',
      },
    ]);
    expect(plan.stages.review).toBe('BROKEN');
  });

  it('после ремонта сломанного этапа требует повторить AI-внедрение', () => {
    const failed = resolveAvailableScenarioAction(
      createScenarioSnapshot(),
      'productDiscovery.knowledge-skill',
      1,
    );
    expect(failed.stages.productDiscovery).toBe('BROKEN');
    const repaired = resolveAvailableScenarioAction(
      snapshotFromPlan(failed),
      'productDiscovery.knowledge-base',
      2,
    );
    expect(repaired.stages.productDiscovery).toBe('AS_IS');
    expect(repaired.activatedActions).toEqual([]);
    expect(repaired.blockedActivations).toEqual([
      {
        actionId: 'productDiscovery.knowledge-skill',
        completedByActionId: 'productDiscovery.knowledge-base',
        reason: 'STAGE_REPAIRED',
        stage: 'productDiscovery',
      },
    ]);
  });

  it('не блокирует старое решение, если текущее действие само включило AI на этапе', () => {
    const { catalog } = createActivationSetup();
    const foundation = catalog.foundation;
    if (!foundation) throw new Error('Нет подготовительного действия');
    catalog.foundation = { ...foundation, stage: 'review' };
    const snapshot = createSnapshot();
    snapshot.stages.review = 'BROKEN';
    snapshot.appliedActions = [{ actionId: 'review-ai', roundNumber: 1, stage: 'review' }];
    const selected = getStageAction(catalog, 'foundation');
    const plan = resolveRound(snapshot, fallbackOnlyRound(), selected, mechanics, catalog);
    expect(plan.stages.review).toBe('AI_ENABLED');
    expect(plan.blockedActivations).toEqual([]);
    expect(plan.activatedActions).toContainEqual({
      actionId: 'review-ai',
      completedByActionId: 'foundation',
      stage: 'review',
    });
  });

  it.each(infrastructurePaths)('$actionId становится рабочим только после подготовки основы', ({
    actionId,
    badEventId,
    failedState,
    goodEventId,
    setupActionIds,
    stage,
  }) => {
    let roundNumber = 1;
    let plan = resolveAvailableScenarioAction(createScenarioSnapshot(), actionId, roundNumber);
    expect(plan.event.id).toBe(badEventId);
    expect(plan.stages[stage]).toBe(failedState);
    expectScenarioContinues(plan, roundNumber);
    for (const setupActionId of setupActionIds) {
      roundNumber += 1;
      plan = resolveAvailableScenarioAction(snapshotFromPlan(plan), setupActionId, roundNumber);
      expectScenarioContinues(plan, roundNumber);
    }
    plan = resolveAvailableScenarioAction(snapshotFromPlan(plan), actionId, roundNumber + 1);
    expect(plan.event.id).toBe(goodEventId);
    expect(plan.stages[stage]).toBe('AI_ENABLED');
  });

  it.each(infrastructurePaths)('$actionId работает, если сначала подготовить все основы', ({
    actionId,
    goodEventId,
    setupActionIds,
    stage,
  }) => {
    let snapshot = createScenarioSnapshot();
    for (const [index, setupActionId] of setupActionIds.entries()) {
      snapshot = snapshotFromPlan(resolveScenarioAction(snapshot, setupActionId, index + 1));
    }
    const plan = resolveAvailableScenarioAction(snapshot, actionId, setupActionIds.length + 1);
    expect(plan.event.id).toBe(goodEventId);
    expect(plan.stages[stage]).toBe('AI_ENABLED');
  });

  it.each([
    [[], 'event-deploy-mcp-without-tests'],
    [['testing.behavior-checks'], 'event-deploy-mcp-without-rollback'],
    [['testing.behavior-checks', 'deployment.rollback-drill'], 'event-deploy-mcp-without-signals'],
  ])('оставляет ручной деплой рабочим при событии %s', (foundationIds, eventId) => {
    const snapshot = createScenarioSnapshot();
    snapshot.appliedActions = foundationIds.map((actionId, index) => ({
      actionId,
      roundNumber: index + 1,
      stage: getStageAction(defaultScenario.stageActions, actionId).stage,
    }));
    const plan = resolveAvailableScenarioAction(
      snapshot,
      'deployment.mcp-tooling',
      foundationIds.length + 1,
    );
    expect(plan.event.id).toBe(eventId);
    expect(plan.stages.deployment).toBe('AS_IS');
  });
});

function withBrokenStageEffect(effect: MetricDelta) {
  return {
    ...mechanics,
    stageStateEffects: { AI_ENABLED: {}, AS_IS: {}, BROKEN: effect },
  } as ScenarioMechanics;
}

function fallbackOnlyRound() {
  const fallback = round.eventRules[1];
  if (!fallback) throw new Error('Нет резервного события');
  return { ...round, eventRules: [structuredClone(fallback)] };
}

function createActivationSetup() {
  const { id: _, ...base } = action;
  const catalog: StageActionCatalog = {
    foundation: { ...base, key: 'F', stage: 'technicalDiscovery' },
    'review-ai': {
      ...base,
      activationRequirements: ['foundation'],
      key: 'R',
      stage: 'review',
    },
    'testing-ai': {
      ...base,
      activationRequirements: ['foundation'],
      key: 'T',
      stage: 'testing',
    },
  };
  return { catalog, selected: getStageAction(catalog, 'foundation') };
}

describe('getAvailableActions', () => {
  it('не даёт повторно фармить действие, но позволяет вернуться и починить этап', () => {
    const { id: usedId, ...used } = action;
    const repair = { ...used, key: 'B', resultingStageState: 'AI_ENABLED' as const };
    const catalog: StageActionCatalog = { [usedId]: used, repair };
    const choice = {
      actionIds: [usedId, 'repair'],
      description: 'Код',
      stage: 'coding' as const,
      title: 'Код',
    };
    const snapshot = createSnapshot();
    snapshot.appliedActions = [{ actionId: usedId, roundNumber: 1, stage: 'coding' }];
    snapshot.stages.coding = 'BROKEN';
    const available = getAvailableActions(catalog, choice, snapshot);
    expect(available.map(({ id }) => id)).toEqual(['repair']);
    expect(
      resolveRound(snapshot, round, available[0] as EngineAction, mechanics, catalog).stages.coding,
    ).toBe('AI_ENABLED');
  });

  it('оставляет все 8 этапов после исчерпания неповторяемых действий', () => {
    for (const state of ['AS_IS', 'AI_ENABLED', 'BROKEN'] as const) {
      const snapshot = exhaustedScenarioSnapshot(state);
      for (const scenarioRound of defaultScenario.rounds) {
        const choices = getAvailableStageChoices(
          defaultScenario.stageActions,
          scenarioRound.stageChoices,
          snapshot,
        );
        expect(choices.map(({ stage }) => stage)).toEqual(stageKeys);
      }
    }
  });
});

function createScenarioSnapshot(): EngineSnapshot {
  return {
    appliedActions: [],
    metrics: createInitialMetrics(defaultScenario.mechanics),
    properties: [],
    stages: createInitialStages(),
  };
}

function exhaustedScenarioSnapshot(
  state: EngineSnapshot['stages'][keyof EngineSnapshot['stages']],
) {
  const snapshot = createScenarioSnapshot();
  snapshot.appliedActions = Object.entries(defaultScenario.stageActions).map(
    ([actionId, action], index) => ({ actionId, roundNumber: index + 1, stage: action.stage }),
  );
  for (const stage of stageKeys) snapshot.stages[stage] = state;
  return snapshot;
}

describe('evaluateOutcome', () => {
  it('считает −8 критическим, а −7 рабочим значением', () => {
    const stages = createInitialStages();
    const critical = { ...createInitialMetrics(mechanics), quality: -8 };
    const safe = { ...createInitialMetrics(mechanics), quality: -7 };
    expect(evaluateOutcome(critical, stages, 1, rules).reason).toBe('CRITICAL_METRIC');
    expect(evaluateOutcome(safe, stages, 1, rules).phase).toBe('FEEDBACK');
  });

  it('даёт победу после пяти раундов и трёх AI-этапов', () => {
    const stages = createInitialStages();
    stages.coding = 'AI_ENABLED';
    stages.review = 'AI_ENABLED';
    stages.testing = 'AI_ENABLED';
    expect(evaluateOutcome(createInitialMetrics(mechanics), stages, 5, rules)).toEqual({
      phase: 'WON',
      reason: null,
    });
  });

  it('считает старые правила без roundMode конечными', () => {
    const stages = createInitialStages();
    stages.coding = 'AI_ENABLED';
    stages.review = 'AI_ENABLED';
    stages.testing = 'AI_ENABLED';
    expect(
      evaluateOutcome(createInitialMetrics(mechanics), stages, 5, {
        ...rules,
        roundMode: undefined,
      }).phase,
    ).toBe('WON');
  });

  it('в циклической игре ждёт, пока позеленеют все восемь этапов', () => {
    const stages = createInitialStages();
    for (const stage of stageKeys.slice(0, -1)) stages[stage] = 'AI_ENABLED';
    const cyclic = { ...rules, minAiStagesToWin: 8, roundMode: 'CYCLIC' as const };
    expect(evaluateOutcome(createInitialMetrics(mechanics), stages, 20, cyclic).phase).toBe(
      'FEEDBACK',
    );
    stages.support = 'AI_ENABLED';
    expect(evaluateOutcome(createInitialMetrics(mechanics), stages, 21, cyclic).phase).toBe('WON');
  });

  it('считает критический показатель поражением, даже если все этапы зелёные', () => {
    const stages = createInitialStages();
    for (const stage of stageKeys) stages[stage] = 'AI_ENABLED';
    const cyclic = { ...rules, minAiStagesToWin: 8, roundMode: 'CYCLIC' as const };
    const metrics = { ...createInitialMetrics(mechanics), quality: rules.criticalThreshold };
    expect(evaluateOutcome(metrics, stages, 8, cyclic)).toEqual({
      phase: 'BROKEN',
      reason: 'CRITICAL_METRIC',
    });
  });

  it('позволяет позеленить все восемь этапов за восемь ходов', () => {
    const actionIds = [
      'businessRequest.expected-outcome',
      'productDiscovery.requirement-draft',
      'technicalDiscovery.code-research',
      'coding.guided-implementation',
      'testing.ai-checks-with-qa',
      'review.context-and-human-risk',
      'deployment.human-approved-plan',
      'support.change-linked-signals',
    ];
    const { phases, snapshot } = playScenarioActions(actionIds);
    expect(phases).toEqual([...actionIds.slice(0, -1).map(() => 'FEEDBACK'), 'WON']);
    expect(Object.values(snapshot.stages)).toEqual(stageKeys.map(() => 'AI_ENABLED'));
    expect(evaluateOutcome(snapshot.metrics, snapshot.stages, 8, defaultScenario.rules).phase).toBe(
      'WON',
    );
  });

  it('позволяет победить через основы и рабочие AI-инструменты', () => {
    const actionIds = [
      'businessRequest.outcome-metrics',
      'businessRequest.feedback-mcp',
      'productDiscovery.knowledge-base',
      'productDiscovery.knowledge-skill',
      'productDiscovery.requirement-draft',
      'technicalDiscovery.dependency-map',
      'technicalDiscovery.ai-impact-analysis',
      'testing.behavior-checks',
      'coding.project-checks',
      'coding.repository-mcp',
      'review.risk-policy',
      'review.review-skill',
      'testing.test-generation-skill',
      'deployment.rollback-drill',
      'support.telemetry-baseline',
      'deployment.mcp-tooling',
      'support.incident-mcp',
    ];
    const { phases, snapshot } = playScenarioActions(actionIds);
    expect(phases.at(-1)).toBe('WON');
    expect(Object.values(snapshot.stages)).toEqual(stageKeys.map(() => 'AI_ENABLED'));
  });

  it('показывает, почему одна основа не включила два сломанных AI-контура', () => {
    const actionIds = [
      'productDiscovery.knowledge-base',
      'testing.test-generation-skill',
      'review.risk-policy',
      'review.review-skill',
      'testing.behavior-checks',
    ];
    const { plans, snapshot } = playScenarioActions(actionIds);
    expect(snapshot.stages.testing).toBe('AS_IS');
    expect(snapshot.stages.review).toBe('BROKEN');
    expect(plans.at(-1)?.blockedActivations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actionId: 'testing.test-generation-skill' }),
        expect.objectContaining({ actionId: 'review.review-skill' }),
      ]),
    );
  });

  it('не завершает игру поражением в первые два хода', () => {
    expect(findEarlyLosses(2)).toEqual([]);
  });
});

function snapshotFromPlan(plan: ReturnType<typeof resolveRound>): EngineSnapshot {
  return {
    appliedActions: plan.appliedActions,
    metrics: plan.metrics,
    properties: plan.properties,
    stages: plan.stages,
  };
}

function expectQueueStages(
  plan: ReturnType<typeof resolveRound>,
  eventId: string,
  state: 'AS_IS' | 'BROKEN',
) {
  expect(plan.event.id).toBe(eventId);
  expect(plan.stages.review).toBe(state);
  expect(plan.stages.testing).toBe(state);
}

function resolveScenarioAction(snapshot: EngineSnapshot, actionId: string, roundNumber: number) {
  const template = defaultScenario.rounds[0] as ScenarioRound;
  const round = { ...template, number: roundNumber };
  const selected = getStageAction(defaultScenario.stageActions, actionId);
  return resolveRound(
    snapshot,
    round,
    selected,
    defaultScenario.mechanics,
    defaultScenario.stageActions,
  );
}

function resolveAvailableScenarioAction(
  snapshot: EngineSnapshot,
  actionId: string,
  roundNumber: number,
) {
  const template = defaultScenario.rounds[0] as ScenarioRound;
  const choice = template.stageChoices.find(({ actionIds }) => actionIds.includes(actionId));
  if (!choice) throw new Error(`Нет выбора для ${actionId}`);
  const available = getAvailableActions(defaultScenario.stageActions, choice, snapshot);
  expect(available.map(({ id }) => id)).toContain(actionId);
  return resolveScenarioAction(snapshot, actionId, roundNumber);
}

function expectScenarioContinues(plan: ReturnType<typeof resolveRound>, roundNumber: number) {
  const outcome = evaluateOutcome(plan.metrics, plan.stages, roundNumber, defaultScenario.rules);
  expect(outcome.phase).toBe('FEEDBACK');
}

function playScenarioActions(actionIds: string[]) {
  let snapshot = createScenarioSnapshot();
  const phases: string[] = [];
  const plans: ReturnType<typeof resolveRound>[] = [];
  actionIds.forEach((actionId, index) => {
    const template = defaultScenario.rounds[index % defaultScenario.rounds.length];
    const round = { ...template, number: index + 1 } as ScenarioRound;
    const action = getStageAction(defaultScenario.stageActions, actionId);
    const plan = resolveRound(
      snapshot,
      round,
      action,
      defaultScenario.mechanics,
      defaultScenario.stageActions,
    );
    snapshot = snapshotFromPlan(plan);
    plans.push(plan);
    const outcome = evaluateOutcome(
      snapshot.metrics,
      snapshot.stages,
      round.number,
      defaultScenario.rules,
    );
    phases.push(outcome.phase);
  });
  return { phases, plans, snapshot };
}

function findEarlyLosses(maxTurns: number) {
  const losses: string[] = [];
  const visit = (snapshot: EngineSnapshot, path: string[]) => {
    if (path.length >= maxTurns) return;
    const template = defaultScenario.rounds[path.length % defaultScenario.rounds.length];
    if (!template) throw new Error('Нет шаблона хода');
    const current = { ...template, number: path.length + 1 } as ScenarioRound;
    const choices = getAvailableStageChoices(
      defaultScenario.stageActions,
      current.stageChoices,
      snapshot,
    );
    for (const choice of choices) visitChoice(snapshot, current, choice, path, losses, visit);
  };
  visit(createScenarioSnapshot(), []);
  return losses;
}

function visitChoice(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  choice: ScenarioRound['stageChoices'][number],
  path: string[],
  losses: string[],
  visit: (snapshot: EngineSnapshot, path: string[]) => void,
) {
  const actions = getAvailableActions(defaultScenario.stageActions, choice, snapshot);
  for (const selected of actions) {
    const plan = resolveRound(
      snapshot,
      round,
      selected,
      defaultScenario.mechanics,
      defaultScenario.stageActions,
    );
    const next = snapshotFromPlan(plan);
    const nextPath = [...path, selected.id];
    const outcome = evaluateOutcome(next.metrics, next.stages, round.number, defaultScenario.rules);
    if (outcome.phase === 'BROKEN') losses.push(nextPath.join(' → '));
    else if (outcome.phase === 'FEEDBACK') visit(next, nextPath);
  }
}
