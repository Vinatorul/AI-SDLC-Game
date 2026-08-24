import { type GameRules, stageKeys } from '@ai-sdlc/contracts';
import { describe, expect, it } from 'vitest';
import {
  createInitialMetrics,
  createInitialStages,
  evaluateOutcome,
  getAvailableActions,
  getAvailableStageChoices,
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
  initialMetrics: { controllability: 60, deliverySpeed: 60, quality: 60, teamCapacity: 60 },
  metricBounds: { maximum: 100, minimum: 0 },
  propertyEffects: {
    automatedTests: {},
    currentContext: {},
    humanReview: { quality: 2 },
    observability: {},
    rollback: {},
  },
};

const rules: GameRules = {
  criticalThreshold: 15,
  dangerThreshold: 30,
  minAiStagesToWin: 3,
  notableVoteShare: 0.15,
  requireNoBrokenStages: false,
  roundLimit: 5,
};

const action: EngineAction = {
  addProperties: ['humanReview'],
  availableInStates: ['AS_IS', 'AI_ENABLED', 'BROKEN'],
  description: 'Описание решения',
  effect: { deliverySpeed: 12 },
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
        effect: { quality: -8 },
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
    expect(plan.metrics).toMatchObject({ deliverySpeed: 72, quality: 54 });
    expect(plan.stages.coding).toBe('AI_ENABLED');
    expect(plan.stages.review).toBe('BROKEN');
    expect(plan.appliedActions).toEqual([
      { actionId: 'action-a', roundNumber: 1, stage: 'coding' },
    ]);
  });

  it('берёт границы и эффекты свойств из сценария', () => {
    const configured = {
      ...mechanics,
      metricBounds: { maximum: 65, minimum: 10 },
      propertyEffects: { ...mechanics.propertyEffects, humanReview: { quality: 20 } },
    };
    const plan = resolveRound(createSnapshot(), round, action, configured);
    expect(plan.metrics).toMatchObject({ deliverySpeed: 65, quality: 65 });
  });

  it('проверяет условия события по состоянию до нового действия', () => {
    const conditional = structuredClone(round);
    const firstRule = conditional.eventRules[0];
    if (!firstRule) throw new Error('Нет тестового правила');
    firstRule.hasProperty = 'humanReview';
    const plan = resolveRound(createSnapshot(), conditional, action, mechanics);
    expect(plan.event.id).toBe('event-fallback');
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
  it('считает 15 критическим, а 16 рабочим значением', () => {
    const stages = createInitialStages();
    const critical = { ...createInitialMetrics(mechanics), quality: 15 };
    const safe = { ...createInitialMetrics(mechanics), quality: 16 };
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
});
