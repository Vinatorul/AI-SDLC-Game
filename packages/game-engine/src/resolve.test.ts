import { type GameRules, stageKeys } from '@ai-sdlc/contracts';
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
  evidence: 'SCENARIO',
  id: 'action-a',
  key: 'A',
  repeatable: false,
  resultingStageState: 'AI_ENABLED',
  shortFeedback: 'Обратная связь',
  stage: 'coding',
  title: 'Решение',
};

const round: ScenarioRound = {
  eventRules: [
    {
      actionIds: ['action-a'],
      event: {
        description: 'Описание события',
        effect: { quality: -2 },
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
    const plan = resolveRound(createSnapshot(), round, action, mechanics);
    expect(plan.metrics).toMatchObject({ deliverySpeed: 3, quality: -1 });
    expect(plan.stages.coding).toBe('AI_ENABLED');
    expect(plan.stages.review).toBe('BROKEN');
    expect(plan.appliedActions).toEqual([
      { actionId: 'action-a', roundNumber: 1, stage: 'coding' },
    ]);
  });

  it('берёт границы и эффекты свойств из сценария', () => {
    const configured = {
      ...mechanics,
      metricBounds: { maximum: 2, minimum: -2 },
      propertyEffects: { ...mechanics.propertyEffects, humanReview: { quality: 5 } },
    };
    const plan = resolveRound(createSnapshot(), round, action, configured);
    expect(plan.metrics).toMatchObject({ deliverySpeed: 2, quality: 2 });
  });

  it('проверяет условия события по состоянию до нового действия', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasProperty = 'humanReview';
    const plan = resolveRound(createSnapshot(), conditional, action, mechanics);
    expect(plan.event.id).toBe('event-fallback');
  });

  it('может учитывать свойство, которое добавляет текущее действие', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasResultingProperty = 'humanReview';
    const plan = resolveRound(createSnapshot(), conditional, action, mechanics);
    expect(plan.event.id).toBe('event-selected');
  });

  it('учитывает историю, состояния и число ходов по этапу', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasAppliedActions = ['test-baseline'];
    firstRule.appliedActionCount = { maximum: 1, minimum: 1 };
    firstRule.stageActionCounts = [{ maximum: 1, minimum: 1, stage: 'testing' }];
    firstRule.stageStates = [{ stage: 'coding', state: 'AS_IS' }];
    const snapshot = createSnapshot();
    snapshot.appliedActions = [{ actionId: 'test-baseline', roundNumber: 1, stage: 'testing' }];
    expect(resolveRound(snapshot, conditional, action, mechanics).event.id).toBe('event-selected');
  });

  it('позволяет TTM дойти до критического порога на рискованной ветке', () => {
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
        resolveRound(snapshot, current, action, defaultScenario.mechanics),
      );
    }
    expect(snapshot.metrics.deliverySpeed).toBe(defaultScenario.rules.criticalThreshold);
  });
});

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
      resolveRound(snapshot, round, available[0] as EngineAction, mechanics).stages.coding,
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
      'businessRequest.incident-feedback',
      'testing.ai-checks-with-qa',
      'productDiscovery.requirement-draft',
      'technicalDiscovery.code-research',
      'coding.guided-implementation',
      'review.context-and-human-risk',
      'deployment.human-approved-plan',
      'support.change-linked-signals',
    ];
    let snapshot = createScenarioSnapshot();
    actionIds.forEach((actionId, index) => {
      const template = defaultScenario.rounds[index % defaultScenario.rounds.length];
      const scenarioRound = { ...template, number: index + 1 } as ScenarioRound;
      const action = getStageAction(defaultScenario.stageActions, actionId);
      snapshot = snapshotFromPlan(
        resolveRound(snapshot, scenarioRound, action, defaultScenario.mechanics),
      );
    });
    expect(Object.values(snapshot.stages)).toEqual(stageKeys.map(() => 'AI_ENABLED'));
    expect(evaluateOutcome(snapshot.metrics, snapshot.stages, 8, defaultScenario.rules).phase).toBe(
      'WON',
    );
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
