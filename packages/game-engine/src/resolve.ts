import {
  type EffectContribution,
  type GameRules,
  type MetricDelta,
  type MetricKey,
  type MetricValues,
  metricKeys,
  type ProcessProperty,
  type StageKey,
  type StageMutation,
  type StageState,
  stageKeys,
} from '@ai-sdlc/contracts';
import type {
  CountRange,
  EngineAction,
  EngineSnapshot,
  EventRule,
  GameMechanics,
  OutcomeEvaluation,
  ResolutionPlan,
  ScenarioRound,
  ScenarioStageChoice,
  StageActionCatalog,
} from './types';

type GatedEffect = {
  blockedByStages: Partial<Record<MetricKey, StageKey[]>>;
  blockedEffect: MetricDelta;
  effect: MetricDelta;
};

export function createInitialMetrics(mechanics: GameMechanics): MetricValues {
  return { ...mechanics.initialMetrics };
}

export function createInitialStages(): EngineSnapshot['stages'] {
  return Object.fromEntries(stageKeys.map((key) => [key, 'AS_IS'])) as EngineSnapshot['stages'];
}

export function resolveRound(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  action: EngineAction,
  mechanics: GameMechanics,
  catalog: StageActionCatalog,
): ResolutionPlan {
  const event = selectEvent(round.eventRules, action, snapshot);
  const properties = mergeProperties(snapshot.properties, action.addProperties);
  const appliedActions = appendAppliedAction(snapshot, action, round.number);
  const stages = resolveStages(snapshot, action, event, appliedActions, catalog);
  const narrativeEffects = gateNarrativeEffects(action, event, stages, mechanics);
  const { breakdown, metrics } = calculateRoundMetrics(
    snapshot,
    properties,
    stages,
    narrativeEffects,
    mechanics,
  );
  const effectContributions = createEffectContributions(
    action,
    event,
    narrativeEffects,
    properties,
    stages,
    mechanics,
  );
  return { appliedActions, breakdown, effectContributions, event, metrics, properties, stages };
}

function calculateRoundMetrics(
  snapshot: EngineSnapshot,
  properties: EngineSnapshot['properties'],
  stages: EngineSnapshot['stages'],
  effects: { decision: GatedEffect; event: GatedEffect },
  mechanics: GameMechanics,
) {
  const propertyDelta = collectPropertyEffects(properties, mechanics);
  const pipelineDelta = collectStageStateEffects(stages, mechanics);
  const raw = createBreakdown(
    effects.decision.effect,
    effects.event.effect,
    propertyDelta,
    pipelineDelta,
  );
  const metrics = applyMetricDelta(snapshot.metrics, raw.total, mechanics);
  const applied = metricDifference(snapshot.metrics, metrics);
  return { breakdown: { ...raw, applied }, metrics };
}

function resolveStages(
  snapshot: EngineSnapshot,
  action: EngineAction,
  event: ResolutionPlan['event'],
  appliedActions: EngineSnapshot['appliedActions'],
  catalog: StageActionCatalog,
) {
  const mutation = actionStageMutation(action, snapshot.stages[action.stage]);
  const decisionStages = applyStageChanges(snapshot.stages, [mutation]);
  const eventStages = applyStageChanges(decisionStages, event.stageChanges);
  return activateNewlyReadyActions(eventStages, snapshot, appliedActions, catalog);
}

export function getAvailableActions(
  catalog: StageActionCatalog,
  choice: ScenarioStageChoice,
  snapshot: EngineSnapshot,
): EngineAction[] {
  return choice.actionIds
    .map((id) => getStageAction(catalog, id))
    .filter((action) => action.stage === choice.stage)
    .filter((action) => action.availableInStates.includes(snapshot.stages[choice.stage]))
    .filter((action) => action.repeatable || !wasApplied(snapshot, action.id));
}

export function getAvailableStageChoices(
  catalog: StageActionCatalog,
  choices: ScenarioStageChoice[],
  snapshot: EngineSnapshot,
) {
  return choices
    .filter((choice) => getAvailableActions(catalog, choice, snapshot).length > 0)
    .sort((left, right) => stageKeys.indexOf(left.stage) - stageKeys.indexOf(right.stage));
}

export function getStageAction(catalog: StageActionCatalog, actionId: string): EngineAction {
  const action = catalog[actionId];
  if (!action) throw new Error(`Неизвестное действие ${actionId}`);
  return { ...action, id: actionId };
}

export function evaluateOutcome(
  metrics: MetricValues,
  stages: EngineSnapshot['stages'],
  completedRounds: number,
  rules: GameRules,
): OutcomeEvaluation {
  if (metricKeys.some((key) => metrics[key] <= rules.criticalThreshold)) {
    return { phase: 'BROKEN', reason: 'CRITICAL_METRIC' };
  }
  const aiStages = stageKeys.filter((key) => stages[key] === 'AI_ENABLED').length;
  if (rules.roundMode === 'CYCLIC') {
    return cyclicOutcome(stages, aiStages, rules);
  }
  if (completedRounds < rules.roundLimit) return { phase: 'FEEDBACK', reason: null };
  if (aiStages < rules.minAiStagesToWin) return { phase: 'BROKEN', reason: 'AI_NOT_EMBEDDED' };
  const hasBrokenStage = stageKeys.some((key) => stages[key] === 'BROKEN');
  if (rules.requireNoBrokenStages && hasBrokenStage) {
    return { phase: 'BROKEN', reason: 'BROKEN_STAGES_REMAIN' };
  }
  return { phase: 'WON', reason: null };
}

function cyclicOutcome(
  stages: EngineSnapshot['stages'],
  aiStages: number,
  rules: GameRules,
): OutcomeEvaluation {
  if (aiStages < rules.minAiStagesToWin) return { phase: 'FEEDBACK', reason: null };
  const hasBrokenStage = stageKeys.some((key) => stages[key] === 'BROKEN');
  if (rules.requireNoBrokenStages && hasBrokenStage) {
    return { phase: 'FEEDBACK', reason: null };
  }
  return { phase: 'WON', reason: null };
}

function selectEvent(rules: EventRule[], action: EngineAction, snapshot: EngineSnapshot) {
  const matched = rules.find((rule) => eventRuleMatches(rule, action, snapshot));
  const fallback = rules.at(-1);
  if (!matched && !fallback) throw new Error('У раунда нет события');
  return (matched ?? fallback)?.event as NonNullable<typeof fallback>['event'];
}

function eventRuleMatches(rule: EventRule, action: EngineAction, snapshot: EngineSnapshot) {
  if (rule.actionIds && !rule.actionIds.includes(action.id)) return false;
  if (rule.hasProperty && !snapshot.properties.includes(rule.hasProperty)) return false;
  if (rule.missingProperty && snapshot.properties.includes(rule.missingProperty)) return false;
  const resulting = mergeProperties(snapshot.properties, action.addProperties);
  if (rule.hasResultingProperty && !resulting.includes(rule.hasResultingProperty)) return false;
  if (rule.missingResultingProperty && resulting.includes(rule.missingResultingProperty)) {
    return false;
  }
  if (!matchesActionHistory(rule, snapshot)) return false;
  if (!matchesStageStates(rule, snapshot)) return false;
  if (!countInRange(snapshot.appliedActions.length, rule.appliedActionCount)) return false;
  if (!matchesAppliedActionCounts(rule, snapshot)) return false;
  if (!matchesStageActionCounts(rule, snapshot)) return false;
  return true;
}

function matchesActionHistory(rule: EventRule, snapshot: EngineSnapshot) {
  const appliedIds = new Set(snapshot.appliedActions.map(({ actionId }) => actionId));
  if (rule.hasAppliedActions?.some((id) => !appliedIds.has(id))) return false;
  if (rule.missingAppliedActions?.some((id) => appliedIds.has(id))) return false;
  return true;
}

function matchesStageStates(rule: EventRule, snapshot: EngineSnapshot) {
  return (rule.stageStates ?? []).every(({ stage, state }) => snapshot.stages[stage] === state);
}

function matchesAppliedActionCounts(rule: EventRule, snapshot: EngineSnapshot) {
  return (rule.appliedActionCounts ?? []).every(({ actionIds, ...range }) => {
    const relevantIds = new Set(actionIds);
    const count = snapshot.appliedActions.filter(({ actionId }) =>
      relevantIds.has(actionId),
    ).length;
    return countInRange(count, range);
  });
}

function matchesStageActionCounts(rule: EventRule, snapshot: EngineSnapshot) {
  return (rule.stageActionCounts ?? []).every(({ stage, ...range }) => {
    const count = snapshot.appliedActions.filter((action) => action.stage === stage).length;
    return countInRange(count, range);
  });
}

function countInRange(count: number, range?: CountRange) {
  if (range?.minimum !== undefined && count < range.minimum) return false;
  if (range?.maximum !== undefined && count > range.maximum) return false;
  return true;
}

function wasApplied(snapshot: EngineSnapshot, actionId: string) {
  return snapshot.appliedActions.some((action) => action.actionId === actionId);
}

function actionStageMutation(action: EngineAction, current: StageState): StageMutation {
  const state = action.stageTransitions?.[current] ?? action.resultingStageState;
  if (!state) throw new Error(`У действия ${action.id} не задан переход этапа`);
  return { stage: action.stage, state };
}

function activateNewlyReadyActions(
  stages: EngineSnapshot['stages'],
  snapshot: EngineSnapshot,
  appliedActions: EngineSnapshot['appliedActions'],
  catalog: StageActionCatalog,
) {
  const before = new Set(snapshot.appliedActions.map(({ actionId }) => actionId));
  const after = new Set(appliedActions.map(({ actionId }) => actionId));
  const changes = Object.entries(catalog)
    .filter(
      ([id, action]) => !isActionReady(id, action, before) && isActionReady(id, action, after),
    )
    .map(([, action]) => ({ stage: action.stage, state: 'AI_ENABLED' as const }));
  return applyStageChanges(stages, changes);
}

function isActionReady(id: string, action: StageActionCatalog[string], applied: Set<string>) {
  const requirements = action.activationRequirements;
  return Boolean(
    requirements && applied.has(id) && requirements.every((item) => applied.has(item)),
  );
}

function appendAppliedAction(snapshot: EngineSnapshot, action: EngineAction, roundNumber: number) {
  return [...snapshot.appliedActions, { actionId: action.id, roundNumber, stage: action.stage }];
}

function mergeProperties(current: ProcessProperty[], added: ProcessProperty[]) {
  return [...new Set([...current, ...added])];
}

function collectPropertyEffects(
  properties: EngineSnapshot['properties'],
  mechanics: GameMechanics,
): MetricDelta {
  return sumDeltas(properties.map((property) => mechanics.propertyEffects[property]));
}

function collectStageStateEffects(
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
): MetricDelta {
  return sumDeltas(stageKeys.map((stage) => mechanics.stageStateEffects?.[stages[stage]] ?? {}));
}

function createEffectContributions(
  action: EngineAction,
  event: ResolutionPlan['event'],
  narrativeEffects: { decision: GatedEffect; event: GatedEffect },
  properties: EngineSnapshot['properties'],
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
) {
  const contributions: EffectContribution[] = [
    ...narrativeContributions(action, event, narrativeEffects),
    ...propertyContributions(properties, mechanics),
    ...stageContributions(stages, mechanics),
  ];
  return contributions.filter(
    ({ blockedEffect, effect }) => hasMetricEffect(effect) || hasMetricEffect(blockedEffect ?? {}),
  );
}

function narrativeContributions(
  action: EngineAction,
  event: ResolutionPlan['event'],
  effects: { decision: GatedEffect; event: GatedEffect },
): EffectContribution[] {
  return [
    {
      ...blockedEffectFields(effects.decision),
      description: action.shortFeedback ?? action.description,
      effect: effects.decision.effect,
      ...(action.effectReasons ? { effectReasons: action.effectReasons } : {}),
      kind: 'DECISION',
      title: action.title,
    },
    {
      ...blockedEffectFields(effects.event),
      description: event.description,
      effect: effects.event.effect,
      ...(event.effectReasons ? { effectReasons: event.effectReasons } : {}),
      kind: 'EVENT',
      title: event.title,
    },
  ];
}

function gateNarrativeEffects(
  action: EngineAction,
  event: ResolutionPlan['event'],
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
) {
  return {
    decision: gatePositiveEffect(action.effect, action.stage, stages, mechanics),
    event: gatePositiveEffect(event.effect, action.stage, stages, mechanics),
  };
}

function gatePositiveEffect(
  source: MetricDelta,
  actionStage: StageKey,
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
): GatedEffect {
  const result: GatedEffect = { blockedByStages: {}, blockedEffect: {}, effect: {} };
  for (const metric of metricKeys) {
    const value = source[metric];
    if (value === undefined) continue;
    const blocked = value > 0 ? brokenRequirements(metric, actionStage, stages, mechanics) : [];
    if (blocked.length === 0) result.effect[metric] = value;
    else {
      result.blockedEffect[metric] = value;
      result.blockedByStages[metric] = blocked;
    }
  }
  return result;
}

function brokenRequirements(
  metric: MetricKey,
  actionStage: StageKey,
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
) {
  const requirements = mechanics.positiveEffectRequirements;
  if (!requirements) return [];
  const configured = requirements.additionalStages?.[metric]?.[actionStage] ?? [];
  const required = requirements.requireActionStage ? [actionStage, ...configured] : configured;
  return [...new Set(required)].filter((stage) => stages[stage] === 'BROKEN');
}

function blockedEffectFields(effect: GatedEffect) {
  if (!hasMetricEffect(effect.blockedEffect)) return {};
  return { blockedByStages: effect.blockedByStages, blockedEffect: effect.blockedEffect };
}

function propertyContributions(
  properties: EngineSnapshot['properties'],
  mechanics: GameMechanics,
): EffectContribution[] {
  return properties.map((property) => ({
    effect: mechanics.propertyEffects[property],
    ...(mechanics.propertyEffectReasons?.[property]
      ? { effectReasons: mechanics.propertyEffectReasons[property] }
      : {}),
    kind: 'PROPERTY' as const,
    property,
  }));
}

function stageContributions(
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
): EffectContribution[] {
  return stageKeys.map((stage) => ({
    effect: mechanics.stageStateEffects?.[stages[stage]] ?? {},
    ...(mechanics.stageStateEffectReasons?.[stages[stage]]
      ? { effectReasons: mechanics.stageStateEffectReasons[stages[stage]] }
      : {}),
    kind: 'STAGE_STATE' as const,
    stage,
    state: stages[stage],
  }));
}

function createBreakdown(
  decision: MetricDelta,
  event: MetricDelta,
  properties: MetricDelta,
  pipeline: MetricDelta,
) {
  return {
    decision,
    event,
    pipeline,
    properties,
    total: sumDeltas([decision, event, properties, pipeline]),
  };
}

function sumDeltas(deltas: MetricDelta[]): MetricDelta {
  return Object.fromEntries(
    metricKeys.map((key) => [key, deltas.reduce((sum, delta) => sum + (delta[key] ?? 0), 0)]),
  );
}

function hasMetricEffect(effect: MetricDelta) {
  return metricKeys.some((key) => (effect[key] ?? 0) !== 0);
}

function metricDifference(before: MetricValues, after: MetricValues): MetricDelta {
  return Object.fromEntries(metricKeys.map((key) => [key, after[key] - before[key]]));
}

function applyMetricDelta(
  metrics: MetricValues,
  delta: MetricDelta,
  mechanics: GameMechanics,
): MetricValues {
  return Object.fromEntries(
    metricKeys.map((key) => [key, clamp(metrics[key] + (delta[key] ?? 0), mechanics)]),
  ) as MetricValues;
}

function clamp(value: number, mechanics: GameMechanics) {
  return Math.max(mechanics.metricBounds.minimum, Math.min(mechanics.metricBounds.maximum, value));
}

function applyStageChanges(
  stages: EngineSnapshot['stages'],
  changes: StageMutation[],
): Record<keyof EngineSnapshot['stages'], StageState> {
  const next = { ...stages };
  for (const change of changes) next[change.stage] = change.state;
  return next;
}
