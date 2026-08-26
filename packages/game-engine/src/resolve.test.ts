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

  it('штрафует TTM за каждый сломанный этап после события', () => {
    const configured = withBrokenStageEffect({ deliverySpeed: -1 });
    const snapshot = createSnapshot();
    snapshot.stages.testing = 'BROKEN';
    const plan = resolveRound(snapshot, round, action, configured);
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: -2 });
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
    const plan = resolveRound(snapshot, fallbackRound, action, configured);
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: 0 });
    expect(plan.metrics.deliverySpeed).toBe(3);
  });

  it('берёт показатель штрафа из сценария, а не предполагает TTM', () => {
    const configured = withBrokenStageEffect({ quality: -2 });
    const plan = resolveRound(createSnapshot(), round, action, configured);
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: 0, quality: -2 });
    expect(plan.metrics).toMatchObject({ deliverySpeed: 3, quality: -3 });
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

  it('добавляет позднее последствие только после перекоса в кодинг', () => {
    const template = defaultScenario.rounds[0] as ScenarioRound;
    const selected = getStageAction(defaultScenario.stageActions, 'coding.guided-implementation');
    const plan = resolveRound(
      lateCodingSnapshot(1),
      { ...template, number: 7 },
      selected,
      defaultScenario.mechanics,
    );
    expect(plan.event.id).toBe('event-code-without-technical-context');
  });

  it('не добавляет позднее последствие после возврата в техническую проработку', () => {
    const template = defaultScenario.rounds[0] as ScenarioRound;
    const selected = getStageAction(defaultScenario.stageActions, 'coding.guided-implementation');
    const plan = resolveRound(
      lateCodingSnapshot(2),
      { ...template, number: 7 },
      selected,
      defaultScenario.mechanics,
    );
    expect(plan.event.id).toBe('event-code-ready');
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

  it('снижает TTM, когда новый код ломает ревью и тестирование', () => {
    const riskyAction = getStageAction(
      defaultScenario.stageActions,
      'coding.guided-implementation',
    );
    const scenarioRound = defaultScenario.rounds[0] as ScenarioRound;
    const plan = resolveRound(
      createScenarioSnapshot(),
      scenarioRound,
      riskyAction,
      defaultScenario.mechanics,
    );
    expect(plan.event.id).toBe('event-code-outpaces-checks');
    expect(plan.breakdown.pipeline).toMatchObject({ deliverySpeed: -2 });
    expect(plan.metrics.deliverySpeed).toBe(-2);
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
      );
      if (Object.values(plan.stages).includes('BROKEN')) {
        expect(plan.breakdown.total.deliverySpeed ?? 0, actionId).toBeLessThanOrEqual(0);
      }
    }
  });
});

function withBrokenStageEffect(effect: MetricDelta) {
  return {
    ...mechanics,
    stageStateEffects: { AI_ENABLED: {}, AS_IS: {}, BROKEN: effect },
  } as ScenarioMechanics;
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
      'businessRequest.expected-outcome',
      'testing.ai-checks-with-qa',
      'productDiscovery.requirement-draft',
      'technicalDiscovery.code-research',
      'coding.guided-implementation',
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

function lateCodingSnapshot(technicalDiscoveryCount: number) {
  const snapshot = createScenarioSnapshot();
  const stages: EngineAction['stage'][] = ['coding', 'coding'];
  for (let index = 0; index < technicalDiscoveryCount; index += 1) {
    stages.push('technicalDiscovery');
  }
  while (stages.length < 6) stages.push('businessRequest');
  snapshot.appliedActions = stages.map((stage, index) => ({
    actionId: `previous-${index}`,
    roundNumber: index + 1,
    stage,
  }));
  snapshot.properties = ['automatedTests', 'currentContext', 'humanReview'];
  return snapshot;
}

function playScenarioActions(actionIds: string[]) {
  let snapshot = createScenarioSnapshot();
  const phases: string[] = [];
  actionIds.forEach((actionId, index) => {
    const template = defaultScenario.rounds[index % defaultScenario.rounds.length];
    const round = { ...template, number: index + 1 } as ScenarioRound;
    const action = getStageAction(defaultScenario.stageActions, actionId);
    snapshot = snapshotFromPlan(resolveRound(snapshot, round, action, defaultScenario.mechanics));
    const outcome = evaluateOutcome(
      snapshot.metrics,
      snapshot.stages,
      round.number,
      defaultScenario.rules,
    );
    phases.push(outcome.phase);
  });
  return { phases, snapshot };
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
    const plan = resolveRound(snapshot, round, selected, defaultScenario.mechanics);
    const next = snapshotFromPlan(plan);
    const nextPath = [...path, selected.id];
    const outcome = evaluateOutcome(next.metrics, next.stages, round.number, defaultScenario.rules);
    if (outcome.phase === 'BROKEN') losses.push(nextPath.join(' → '));
    else if (outcome.phase === 'FEEDBACK') visit(next, nextPath);
  }
}
