import { metricKeys, stageKeys } from '@ai-sdlc/contracts';
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
import type { EngineSnapshot, ResolutionPlan, ScenarioRound } from './types';

type SimulationResult = 'BROKEN' | 'ONGOING' | 'WON';

function initialSnapshot(): EngineSnapshot {
  return {
    appliedActions: [],
    metrics: createInitialMetrics(defaultScenario.mechanics),
    properties: [],
    stages: createInitialStages(),
  };
}

function snapshotFrom(plan: ResolutionPlan): EngineSnapshot {
  return {
    appliedActions: plan.appliedActions,
    metrics: plan.metrics,
    properties: plan.properties,
    stages: plan.stages,
  };
}

function applyAction(snapshot: EngineSnapshot, actionId: string, number: number) {
  const template = defaultScenario.rounds[(number - 1) % defaultScenario.rounds.length];
  if (!template) throw new Error(`Нет шаблона для хода ${number}`);
  const round = { ...template, number } as ScenarioRound;
  const choice = round.stageChoices.find(({ actionIds }) => actionIds.includes(actionId));
  if (!choice) throw new Error(`Нет выбора для ${actionId}`);
  const availableIds = getAvailableActions(defaultScenario.stageActions, choice, snapshot).map(
    ({ id }) => id,
  );
  if (!availableIds.includes(actionId)) throw new Error(`Действие ${actionId} недоступно`);
  const action = getStageAction(defaultScenario.stageActions, actionId);
  return resolveRound(
    snapshot,
    round,
    action,
    defaultScenario.mechanics,
    defaultScenario.stageActions,
  );
}

function play(actionIds: string[]) {
  let snapshot = initialSnapshot();
  const plans: ResolutionPlan[] = [];
  const phases: string[] = [];
  actionIds.forEach((actionId, index) => {
    const plan = applyAction(snapshot, actionId, index + 1);
    snapshot = snapshotFrom(plan);
    plans.push(plan);
    phases.push(
      evaluateOutcome(snapshot.metrics, snapshot.stages, index + 1, defaultScenario.rules).phase,
    );
  });
  return { phases, plans, snapshot };
}

function repeatWithoutMetricGain(
  snapshot: EngineSnapshot,
  actionId: string,
  firstRound: number,
  repeats: number,
) {
  const first = applyAction(snapshot, actionId, firstRound);
  let current = snapshotFrom(first);
  for (let offset = 1; offset <= repeats; offset += 1) {
    const next = snapshotFrom(applyAction(current, actionId, firstRound + offset));
    for (const metric of metricKeys) {
      expect(next.metrics[metric]).toBeLessThanOrEqual(current.metrics[metric]);
    }
    current = next;
  }
  return { nextRound: firstRound + repeats + 1, snapshot: current };
}

describe('баланс сценария v18', () => {
  it('не начисляет баллы повторно за прежнюю цепочку накопления', () => {
    let snapshot = initialSnapshot();
    let nextRound = 1;
    for (const [actionId, repeats] of [
      ['productDiscovery.requirement-draft', 9],
      ['technicalDiscovery.sync-docs-and-contract', 3],
      ['support.change-linked-signals', 9],
    ] as const) {
      ({ nextRound, snapshot } = repeatWithoutMetricGain(snapshot, actionId, nextRound, repeats));
    }
    expect(Math.max(...Object.values(snapshot.metrics))).toBeLessThan(10);
  });

  it('не заканчивает прежнюю опасную последовательность поражением за три хода', () => {
    const { phases, snapshot } = play([
      'businessRequest.production-signals',
      'support.autonomous-fix',
      'deployment.autonomous-after-tests',
    ]);
    expect(phases).toHaveLength(3);
    expect(phases).not.toContain('BROKEN');
    expect(Math.min(...Object.values(snapshot.metrics))).toBeGreaterThan(
      defaultScenario.rules.criticalThreshold,
    );
  });

  it('позволяет безопасно позеленить восемь этапов без метрики на верхней границе', () => {
    const { phases, snapshot } = play([
      'businessRequest.expected-outcome',
      'productDiscovery.requirement-draft',
      'technicalDiscovery.code-research',
      'coding.guided-implementation',
      'testing.ai-checks-with-qa',
      'review.context-and-human-risk',
      'deployment.human-approved-plan',
      'support.change-linked-signals',
    ]);
    expect(phases.at(-1)).toBe('WON');
    expect(Object.values(snapshot.stages)).toEqual(stageKeys.map(() => 'AI_ENABLED'));
    expect(Math.max(...Object.values(snapshot.metrics))).toBeLessThan(10);
  });

  it('учитывает только код после последней технической проработки', () => {
    const { plans } = play([
      'coding.guided-implementation',
      'coding.guided-implementation',
      'technicalDiscovery.sync-docs-and-contract',
      'coding.guided-implementation',
    ]);
    expect(plans[1]?.event.id).toBe('event-code-without-technical-context');
    expect(plans[3]?.event.id).toBe('event-code-outpaces-review-and-tests');
    expect(plans[3]?.event.id).not.toBe('event-code-without-technical-context');
  });

  it('не ломает ревью и тестирование, когда обе очереди подготовлены', () => {
    const { plans, snapshot } = play([
      'review.risk-policy',
      'testing.behavior-checks',
      'coding.guided-implementation',
      'coding.guided-implementation',
      'coding.guided-implementation',
    ]);
    expect(plans.at(-1)?.event.id).toBe('event-code-ready');
    expect(snapshot.stages.review).not.toBe('BROKEN');
    expect(snapshot.stages.testing).not.toBe('BROKEN');
  });

  it('активирует анализ зависимостей независимо от порядка двух действий', () => {
    const aiFirst = play([
      'technicalDiscovery.ai-impact-analysis',
      'technicalDiscovery.dependency-map',
    ]);
    const foundationFirst = play([
      'technicalDiscovery.dependency-map',
      'technicalDiscovery.ai-impact-analysis',
    ]);
    expect(aiFirst.plans[0]?.event.id).toBe('event-impact-graph-missing');
    expect(aiFirst.plans[1]?.activatedActions).toContainEqual({
      actionId: 'technicalDiscovery.ai-impact-analysis',
      completedByActionId: 'technicalDiscovery.dependency-map',
      stage: 'technicalDiscovery',
    });
    expect(aiFirst.snapshot.stages.technicalDiscovery).toBe('AI_ENABLED');
    expect(foundationFirst.snapshot.stages.technicalDiscovery).toBe('AI_ENABLED');
  });

  it('не чинит сломанное ревью одной основой из другого этапа', () => {
    const { plans, snapshot } = play([
      'review.risk-policy',
      'review.review-skill',
      'testing.behavior-checks',
    ]);
    expect(plans[1]?.event.id).toBe('event-review-skill-without-evidence');
    expect(snapshot.stages.review).toBe('BROKEN');
    expect(plans[2]?.blockedActivations).toContainEqual({
      actionId: 'review.review-skill',
      completedByActionId: 'testing.behavior-checks',
      reason: 'STAGE_BROKEN',
      stage: 'review',
    });
  });
});

function nextSeed(seed: number) {
  return (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
}

function availableActionIds(snapshot: EngineSnapshot, round: ScenarioRound) {
  return getAvailableStageChoices(
    defaultScenario.stageActions,
    round.stageChoices,
    snapshot,
  ).flatMap((choice) =>
    getAvailableActions(defaultScenario.stageActions, choice, snapshot).map(({ id }) => id),
  );
}

type WitnessNode = { path: string[]; snapshot: EngineSnapshot };

const conditionalRules = defaultScenario.rounds.flatMap(({ eventRules }) =>
  eventRules.slice(0, -1),
);
const historyResetStages = [
  ...new Set(
    conditionalRules.flatMap(({ stageActionCountsSinceLast }) =>
      (stageActionCountsSinceLast ?? []).map(({ sinceStage }) => sinceStage),
    ),
  ),
];

function conditionalEventIds() {
  return conditionalRules.map(({ event }) => event.id);
}

function historySuffixes(snapshot: EngineSnapshot) {
  return historyResetStages.map((stage) => {
    const last = snapshot.appliedActions.findLastIndex((action) => action.stage === stage);
    const suffix = snapshot.appliedActions.slice(last + 1).map(({ actionId }) => actionId);
    return [stage, suffix.sort()];
  });
}

function canonicalSnapshotKey(snapshot: EngineSnapshot) {
  const history = snapshot.appliedActions.map(({ actionId }) => actionId).sort();
  return JSON.stringify([
    history,
    historySuffixes(snapshot),
    [...snapshot.properties].sort(),
    stageKeys.map((stage) => snapshot.stages[stage]),
    metricKeys.map((metric) => snapshot.metrics[metric]),
  ]);
}

function resolveWitnessAction(snapshot: EngineSnapshot, round: ScenarioRound, actionId: string) {
  return resolveRound(
    snapshot,
    round,
    getStageAction(defaultScenario.stageActions, actionId),
    defaultScenario.mechanics,
    defaultScenario.stageActions,
  );
}

function unresolvedActionIds(found: Map<string, string[]>) {
  const unresolved = conditionalRules.filter(({ event }) => !found.has(event.id));
  if (unresolved.some(({ actionIds }) => !actionIds)) {
    return new Set(Object.keys(defaultScenario.stageActions));
  }
  return new Set(unresolved.flatMap(({ actionIds }) => actionIds ?? []));
}

function remainsPlayable(snapshot: EngineSnapshot, number: number) {
  return (
    evaluateOutcome(snapshot.metrics, snapshot.stages, number, defaultScenario.rules).phase ===
    'FEEDBACK'
  );
}

function candidateActionIds(snapshot: EngineSnapshot, round: ScenarioRound, focused?: Set<string>) {
  const actionIds = availableActionIds(snapshot, round);
  return focused ? actionIds.filter((actionId) => focused.has(actionId)) : actionIds;
}

function findEventWitnesses(maxDepth: number) {
  const targets = new Set(conditionalEventIds());
  const found = new Map<string, string[]>();
  const initial = initialSnapshot();
  const queue: WitnessNode[] = [{ path: [], snapshot: initial }];
  const seen = new Set([canonicalSnapshotKey(initial)]);
  let lastStepActions: Set<string> | undefined;
  for (let cursor = 0; cursor < queue.length && found.size < targets.size; cursor += 1) {
    const node = queue[cursor] as WitnessNode;
    const number = node.path.length + 1;
    const template = defaultScenario.rounds[(number - 1) % defaultScenario.rounds.length];
    if (!template) throw new Error(`Нет шаблона для хода ${number}`);
    const round = { ...template, number } as ScenarioRound;
    if (node.path.length === maxDepth - 1) lastStepActions ??= unresolvedActionIds(found);
    for (const actionId of candidateActionIds(node.snapshot, round, lastStepActions)) {
      const plan = resolveWitnessAction(node.snapshot, round, actionId);
      const path = [...node.path, actionId];
      if (targets.has(plan.event.id) && !found.has(plan.event.id)) found.set(plan.event.id, path);
      if (path.length >= maxDepth) continue;
      const snapshot = snapshotFrom(plan);
      if (!remainsPlayable(snapshot, number)) continue;
      const key = canonicalSnapshotKey(snapshot);
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push({ path, snapshot });
    }
  }
  return { found, targets, visited: seen.size };
}

describe('достижимость событий сценария v18', () => {
  it('находит цепочку решений для каждого условного события', () => {
    expect(defaultScenario.version).toBe(18);
    const { found, targets, visited } = findEventWitnesses(4);
    expect(targets.size).toBe(63);
    const unreachable = [...targets].filter((eventId) => !found.has(eventId)).sort();
    expect(
      unreachable,
      `Проверено ${visited} состояний; недостижимы: ${unreachable.join(', ')}`,
    ).toEqual([]);
  });
});

function simulateOne(initialSeed: number, horizon: number): SimulationResult {
  let seed = initialSeed;
  let snapshot = initialSnapshot();
  for (let number = 1; number <= horizon; number += 1) {
    const template = defaultScenario.rounds[(number - 1) % defaultScenario.rounds.length];
    if (!template) throw new Error(`Нет шаблона для хода ${number}`);
    const round = { ...template, number } as ScenarioRound;
    const actionIds = availableActionIds(snapshot, round);
    seed = nextSeed(seed);
    const actionId = actionIds[seed % actionIds.length];
    if (!actionId) throw new Error(`Нет доступного действия на ходу ${number}`);
    snapshot = snapshotFrom(applyAction(snapshot, actionId, number));
    const phase = evaluateOutcome(
      snapshot.metrics,
      snapshot.stages,
      number,
      defaultScenario.rules,
    ).phase;
    if (phase !== 'FEEDBACK') return phase;
  }
  return 'ONGOING';
}

function simulateBatch(seed: number, games: number, horizon: number) {
  const totals: Record<SimulationResult, number> = { BROKEN: 0, ONGOING: 0, WON: 0 };
  for (let index = 0; index < games; index += 1) {
    seed = nextSeed(seed);
    totals[simulateOne(seed, horizon)] += 1;
  }
  return totals;
}

function countEarlyOutcomes(maxTurns: number) {
  const totals: Record<'BROKEN' | 'FEEDBACK' | 'WON', number> = {
    BROKEN: 0,
    FEEDBACK: 0,
    WON: 0,
  };
  const brokenPaths: string[][] = [];
  const visit = (snapshot: EngineSnapshot, number: number, path: string[]) => {
    const template = defaultScenario.rounds[(number - 1) % defaultScenario.rounds.length];
    if (!template) throw new Error(`Нет шаблона для хода ${number}`);
    const round = { ...template, number } as ScenarioRound;
    for (const actionId of availableActionIds(snapshot, round)) {
      const next = snapshotFrom(applyAction(snapshot, actionId, number));
      const nextPath = [...path, actionId];
      const phase = evaluateOutcome(next.metrics, next.stages, number, defaultScenario.rules).phase;
      if (number === maxTurns || phase !== 'FEEDBACK') {
        totals[phase] += 1;
        if (phase === 'BROKEN') brokenPaths.push(nextPath);
      } else visit(next, number + 1, nextPath);
    }
  };
  visit(initialSnapshot(), 1, []);
  return { brokenPaths, totals };
}

describe('диагностика сценария с фиксированным seed', () => {
  it('воспроизводит один и тот же результат на 200 играх', () => {
    const first = simulateBatch(17, 200, 16);
    const second = simulateBatch(17, 200, 16);
    expect(second).toEqual(first);
    expect(first.BROKEN + first.ONGOING + first.WON).toBe(200);
    console.info('v18 fixed-seed diagnostic', first);
  });

  it('допускает раннее поражение только после двух опасных автономных релизов', () => {
    const { brokenPaths, totals } = countEarlyOutcomes(3);
    expect(totals.BROKEN + totals.FEEDBACK + totals.WON).toBeGreaterThan(0);
    expect(brokenPaths).not.toHaveLength(0);
    for (const path of brokenPaths) {
      const autonomousReleases = path.filter(
        (actionId) => actionId === 'deployment.autonomous-after-tests',
      );
      expect(autonomousReleases.length).toBeGreaterThanOrEqual(2);
    }
  });
});
