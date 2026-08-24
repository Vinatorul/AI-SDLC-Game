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
  EngineOption,
  EngineSnapshot,
  EventRule,
  OutcomeEvaluation,
  ResolutionPlan,
  ScenarioMechanics,
  ScenarioRound,
} from './types';

export function createInitialMetrics(mechanics: ScenarioMechanics): MetricValues {
  return { ...mechanics.initialMetrics };
}

export function createInitialStages(): EngineSnapshot['stages'] {
  return Object.fromEntries(stageKeys.map((key) => [key, 'AS_IS'])) as EngineSnapshot['stages'];
}

export function resolveRound(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  option: EngineOption,
  mechanics: ScenarioMechanics,
): ResolutionPlan {
  const event = selectEvent(round.eventRules, option.id, snapshot.properties);
  const properties = mergeProperties(snapshot.properties, option.addProperties);
  const propertyDelta = collectPropertyEffects(properties, mechanics);
  const breakdown = createBreakdown(option.effect, event.effect, propertyDelta);
  const metrics = applyMetricDelta(snapshot.metrics, breakdown.total, mechanics);
  const decisionStages = applyStageChanges(snapshot.stages, option.stageChanges);
  const stages = applyStageChanges(decisionStages, event.stageChanges);
  return { breakdown, event, metrics, properties, stages };
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
  if (completedRounds < rules.roundLimit) return { phase: 'FEEDBACK', reason: null };
  const aiStages = stageKeys.filter((key) => stages[key] === 'AI_ENABLED').length;
  if (aiStages < rules.minAiStagesToWin) return { phase: 'BROKEN', reason: 'AI_NOT_EMBEDDED' };
  const hasBrokenStage = stageKeys.some((key) => stages[key] === 'BROKEN');
  if (rules.requireNoBrokenStages && hasBrokenStage) {
    return { phase: 'BROKEN', reason: 'BROKEN_STAGES_REMAIN' };
  }
  return { phase: 'WON', reason: null };
}

function selectEvent(rules: EventRule[], optionId: string, properties: ProcessProperty[]) {
  const matched = rules.find((rule) => eventRuleMatches(rule, optionId, properties));
  const fallback = rules.at(-1);
  if (!matched && !fallback) throw new Error('У раунда нет события');
  return (matched ?? fallback)?.event as NonNullable<typeof fallback>['event'];
}

function eventRuleMatches(rule: EventRule, optionId: string, properties: ProcessProperty[]) {
  if (rule.optionIds && !rule.optionIds.includes(optionId)) return false;
  if (rule.hasProperty && !properties.includes(rule.hasProperty)) return false;
  if (rule.missingProperty && properties.includes(rule.missingProperty)) return false;
  return true;
}

function mergeProperties(current: ProcessProperty[], added: ProcessProperty[]) {
  return [...new Set([...current, ...added])];
}

function collectPropertyEffects(
  properties: EngineSnapshot['properties'],
  mechanics: ScenarioMechanics,
): MetricDelta {
  return sumDeltas(properties.map((property) => mechanics.propertyEffects[property]));
}

function createBreakdown(decision: MetricDelta, event: MetricDelta, properties: MetricDelta) {
  return { decision, event, properties, total: sumDeltas([decision, event, properties]) };
}

function sumDeltas(deltas: MetricDelta[]): MetricDelta {
  return Object.fromEntries(
    metricKeys.map((key) => [key, deltas.reduce((sum, delta) => sum + (delta[key] ?? 0), 0)]),
  );
}

function applyMetricDelta(
  metrics: MetricValues,
  delta: MetricDelta,
  mechanics: ScenarioMechanics,
): MetricValues {
  return Object.fromEntries(
    metricKeys.map((key) => [key, clamp(metrics[key] + (delta[key] ?? 0), mechanics)]),
  ) as MetricValues;
}

function clamp(value: number, mechanics: ScenarioMechanics) {
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
