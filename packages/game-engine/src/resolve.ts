import {
  type ActivatedAction,
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
import { eventRuleMatches } from './event-conditions';
import type {
  EngineAction,
  EngineEvent,
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

type Narrative = {
  actionEffect: MetricDelta;
  actionReasons?: EngineAction['effectReasons'];
  eventEffect: MetricDelta;
  eventReasons?: ResolutionPlan['event']['effectReasons'];
};

type PreparedRound = Pick<
  ResolutionPlan,
  'activatedActions' | 'appliedActions' | 'blockedActivations' | 'event' | 'properties' | 'stages'
> & { narrative: Narrative };

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
  return resolveRoundWithEvent(snapshot, round, action, event, mechanics, catalog);
}

export function resolveRoundWithEvent(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  action: EngineAction,
  event: EngineEvent,
  mechanics: GameMechanics,
  catalog: StageActionCatalog,
): ResolutionPlan {
  const prepared = prepareRound(snapshot, round, action, event, catalog);
  const { narrative, ...plan } = prepared;
  const narrativeEffects = gateNarrativeEffects(narrative, action.stage, plan.stages, mechanics);
  const { breakdown, metrics } = calculateRoundMetrics(
    snapshot,
    plan.properties,
    plan.stages,
    narrativeEffects,
    mechanics,
  );
  const effectContributions = createEffectContributions(
    action,
    prepared,
    narrativeEffects,
    mechanics,
  );
  return { ...plan, breakdown, effectContributions, metrics };
}

function prepareRound(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  action: EngineAction,
  event: EngineEvent,
  catalog: StageActionCatalog,
): PreparedRound {
  const properties = mergeProperties(
    mergeProperties(snapshot.properties, action.addProperties),
    event.addProperties ?? [],
    event.removeProperties,
  );
  const appliedActions = appendAppliedAction(snapshot, action, round.number);
  const { activatedActions, blockedActivations, stages } = resolveStages(
    snapshot,
    action,
    event,
    appliedActions,
    catalog,
  );
  return {
    activatedActions,
    appliedActions,
    blockedActivations,
    event,
    narrative: selectNarrative(action, event, wasApplied(snapshot, action.id)),
    properties,
    stages,
  };
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
  const repairedStage =
    snapshot.stages[action.stage] === 'BROKEN' && decisionStages[action.stage] === 'AS_IS'
      ? action.stage
      : undefined;
  return activateNewlyReadyActions(
    eventStages,
    snapshot,
    appliedActions,
    catalog,
    action.id,
    repairedStage,
  );
}

function selectNarrative(
  action: EngineAction,
  event: ResolutionPlan['event'],
  repeated: boolean,
): Narrative {
  if (!repeated) {
    return {
      actionEffect: action.effect,
      actionReasons: action.effectReasons,
      eventEffect: event.effect,
      eventReasons: event.effectReasons,
    };
  }
  return {
    actionEffect: action.repeatEffect ?? {},
    actionReasons: action.repeatEffectReasons,
    eventEffect: event.repeatEffect ?? {},
    eventReasons: event.repeatEffectReasons,
  };
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
  completedByActionId: string,
  repairedStage?: StageKey,
) {
  const before = new Set(snapshot.appliedActions.map(({ actionId }) => actionId));
  const after = new Set(appliedActions.map(({ actionId }) => actionId));
  const readyActions = readyOldActions(before, after, catalog, completedByActionId, repairedStage);
  const { activatedActions, blockedActivations } = partitionActivations(
    readyActions,
    snapshot.stages,
    stages,
    repairedStage,
  );
  const changes = activatedActions.map(({ stage }) => ({ stage, state: 'AI_ENABLED' as const }));
  return { activatedActions, blockedActivations, stages: applyStageChanges(stages, changes) };
}

function partitionActivations(
  activations: ActivatedAction[],
  before: EngineSnapshot['stages'],
  after: EngineSnapshot['stages'],
  repairedStage?: StageKey,
) {
  const outcomes = activations.map((activation) => ({
    activation,
    reason: activationBlockReason(activation.stage, before, after, repairedStage),
  }));
  return {
    activatedActions: outcomes.flatMap(({ activation, reason }) => (reason ? [] : [activation])),
    blockedActivations: outcomes.flatMap(({ activation, reason }) =>
      reason ? [{ ...activation, reason }] : [],
    ),
  };
}

function activationBlockReason(
  stage: StageKey,
  before: EngineSnapshot['stages'],
  after: EngineSnapshot['stages'],
  repairedStage?: StageKey,
) {
  if (after[stage] === 'BROKEN') return 'STAGE_BROKEN' as const;
  if (before[stage] === 'BROKEN' && after[stage] === 'AS_IS' && repairedStage !== stage) {
    return 'STAGE_REPAIRED' as const;
  }
  return null;
}

function readyOldActions(
  before: Set<string>,
  after: Set<string>,
  catalog: StageActionCatalog,
  completedByActionId: string,
  repairedStage?: StageKey,
) {
  return Object.entries(catalog)
    .filter(
      ([id, action]) =>
        before.has(id) &&
        isActionReady(id, action, after) &&
        (!isActionReady(id, action, before) || action.stage === repairedStage),
    )
    .map(([actionId, action]) => ({ actionId, completedByActionId, stage: action.stage }));
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

function mergeProperties(
  current: ProcessProperty[],
  added: ProcessProperty[],
  removed: ProcessProperty[] = [],
) {
  return [...new Set([...current, ...added])].filter((property) => !removed.includes(property));
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
  prepared: PreparedRound,
  narrativeEffects: { decision: GatedEffect; event: GatedEffect },
  mechanics: GameMechanics,
) {
  const { event, narrative, properties, stages } = prepared;
  const contributions: EffectContribution[] = [
    ...narrativeContributions(action, event, narrative, narrativeEffects),
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
  narrative: Narrative,
  effects: { decision: GatedEffect; event: GatedEffect },
): EffectContribution[] {
  return [
    {
      ...blockedEffectFields(effects.decision),
      description: action.shortFeedback ?? action.description,
      effect: effects.decision.effect,
      ...(narrative.actionReasons ? { effectReasons: narrative.actionReasons } : {}),
      kind: 'DECISION',
      title: action.title,
    },
    {
      ...blockedEffectFields(effects.event),
      description: event.description,
      effect: effects.event.effect,
      ...(narrative.eventReasons ? { effectReasons: narrative.eventReasons } : {}),
      kind: 'EVENT',
      title: event.title,
    },
  ];
}

function gateNarrativeEffects(
  narrative: Narrative,
  actionStage: StageKey,
  stages: EngineSnapshot['stages'],
  mechanics: GameMechanics,
) {
  return {
    decision: gatePositiveEffect(narrative.actionEffect, actionStage, stages, mechanics),
    event: gatePositiveEffect(narrative.eventEffect, actionStage, stages, mechanics),
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
    const required = positiveEffectStages(metric, actionStage, mechanics);
    const blocked = value > 0 ? required.filter((stage) => stages[stage] === 'BROKEN') : [];
    if (blocked.length === 0) result.effect[metric] = value;
    else {
      result.blockedEffect[metric] = value;
      result.blockedByStages[metric] = blocked;
    }
  }
  return result;
}

export function positiveEffectStages(
  metric: MetricKey,
  actionStage: StageKey,
  mechanics: GameMechanics,
) {
  const requirements = mechanics.positiveEffectRequirements;
  if (!requirements) return [];
  const configured = requirements.additionalStages?.[metric]?.[actionStage] ?? [];
  const required = requirements.requireActionStage ? [actionStage, ...configured] : configured;
  return [...new Set(required)];
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
