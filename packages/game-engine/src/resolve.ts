import {
  type GameRules,
  type MetricDelta,
  type MetricValues,
  metricKeys,
  type ProcessProperty,
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
  const currentStage = snapshot.stages[action.stage];
  const decisionStages = applyStageChanges(snapshot.stages, [
    actionStageMutation(action, currentStage),
  ]);
  const eventStages = applyStageChanges(decisionStages, event.stageChanges);
  const stages = activateNewlyReadyActions(eventStages, snapshot, appliedActions, catalog);
  const propertyDelta = collectPropertyEffects(properties, mechanics);
  const pipelineDelta = collectStageStateEffects(stages, mechanics);
  const breakdown = createBreakdown(action.effect, event.effect, propertyDelta, pipelineDelta);
  const metrics = applyMetricDelta(snapshot.metrics, breakdown.total, mechanics);
  return { appliedActions, breakdown, event, metrics, properties, stages };
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
