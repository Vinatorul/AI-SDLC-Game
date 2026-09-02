import {
  type ActionPotentialView,
  type EventBranchView,
  type ForecastInfluence,
  metricKeys,
  type ProcessProperty,
  type StageState,
  stageKeys,
} from '@ai-sdlc/contracts';
import { evaluateEventRule } from './event-conditions';
import { positiveEffectStages, resolveRoundWithEvent } from './resolve';
import type {
  EngineAction,
  EngineSnapshot,
  EventRule,
  GameMechanics,
  ResolutionPlan,
  ScenarioRound,
  StageActionCatalog,
} from './types';

type ForecastContext = {
  action: EngineAction;
  catalog: StageActionCatalog;
  mechanics: GameMechanics;
  plan: ResolutionPlan;
  round: ScenarioRound;
  snapshot: EngineSnapshot;
};

export function activationRequirements(
  action: EngineAction,
  snapshot: EngineSnapshot,
  catalog: StageActionCatalog,
): ActionPotentialView['activationRequirements'] {
  const applied = new Set(snapshot.appliedActions.map(({ actionId }) => actionId));
  return (action.activationRequirements ?? []).map((actionId) => ({
    actionId,
    satisfied: applied.has(actionId),
    title: actionTitle(catalog, actionId),
  }));
}

export function eventBranches(context: ForecastContext): EventBranchView[] {
  const baseline = baselinePlan(context);
  return context.round.eventRules.flatMap((rule) => {
    if (!isDynamicRuleForAction(rule, context.action.id)) return [];
    const evaluation = evaluateEventRule(rule, context.action, context.snapshot, context.catalog);
    const branch = resolveRoundWithEvent(
      context.snapshot,
      context.round,
      context.action,
      rule.event,
      context.mechanics,
      context.catalog,
    );
    return [
      {
        conditions: evaluation.conditions,
        eventId: rule.event.id,
        influence: comparePlans(branch, baseline),
        matched: evaluation.matched,
        selected: context.plan.event.id === rule.event.id,
        title: rule.event.title,
      },
    ];
  });
}

export function positiveRequirements(
  action: EngineAction,
  plan: ResolutionPlan,
  mechanics: GameMechanics,
): ActionPotentialView['positiveEffectRequirements'] {
  const requirements = plan.effectContributions.flatMap((contribution) => {
    if (contribution.kind !== 'DECISION' && contribution.kind !== 'EVENT') return [];
    return metricKeys.flatMap((metric) => {
      const value =
        (contribution.effect[metric] ?? 0) + (contribution.blockedEffect?.[metric] ?? 0);
      if (value <= 0) return [];
      return positiveEffectStages(metric, action.stage, mechanics).map((stage) => ({
        metric,
        satisfied: plan.stages[stage] !== 'BROKEN',
        stage,
      }));
    });
  });
  return uniquePositiveRequirements(requirements);
}

function baselinePlan(context: ForecastContext) {
  const fallback = baseRuleForAction(context.round.eventRules, context.action.id);
  return resolveRoundWithEvent(
    context.snapshot,
    context.round,
    context.action,
    fallback.event,
    context.mechanics,
    context.catalog,
  );
}

function baseRuleForAction(rules: EventRule[], actionId: string) {
  const specific = rules.find(
    (rule) => rule.actionIds?.includes(actionId) && !hasDynamicConditions(rule),
  );
  const fallback = rules.findLast((rule) => !rule.actionIds && !hasDynamicConditions(rule));
  if (!specific && !fallback) throw new Error(`Нет обычного события для действия ${actionId}`);
  return (specific ?? fallback) as EventRule;
}

function isDynamicRuleForAction(rule: EventRule, actionId: string) {
  const applies = !rule.actionIds || rule.actionIds.includes(actionId);
  return applies && hasDynamicConditions(rule);
}

function hasDynamicConditions(rule: EventRule) {
  return Boolean(
    rule.appliedActionCount ||
      rule.appliedActionCounts ||
      rule.hasAppliedActions ||
      rule.hasProperty ||
      rule.hasResultingProperty ||
      rule.missingAppliedActions ||
      rule.missingProperty ||
      rule.missingResultingProperty ||
      rule.stageActionCounts ||
      rule.stageActionCountsSinceLast ||
      rule.stageStates,
  );
}

function comparePlans(candidate: ResolutionPlan, baseline: ResolutionPlan): ForecastInfluence {
  const metricSigns = metricKeys.map((key) =>
    Math.sign(candidate.metrics[key] - baseline.metrics[key]),
  );
  const stageSigns = stageKeys.map((key) => stageSign(candidate.stages[key], baseline.stages[key]));
  const propertySigns = propertySignsBetween(candidate.properties, baseline.properties);
  const signs = [...metricSigns, ...stageSigns, ...propertySigns];
  const improves = signs.some((value) => value > 0);
  const worsens = signs.some((value) => value < 0);
  if (improves && worsens) return 'MIXED';
  if (improves) return 'IMPROVES';
  if (worsens) return 'WORSENS';
  return 'NEUTRAL';
}

function stageSign(candidate: StageState, baseline: StageState) {
  const rank: Record<StageState, number> = { AI_ENABLED: 1, AS_IS: 0, BROKEN: -1 };
  return Math.sign(rank[candidate] - rank[baseline]);
}

function propertySignsBetween(candidate: ProcessProperty[], baseline: ProcessProperty[]) {
  const candidateSet = new Set(candidate);
  const baselineSet = new Set(baseline);
  const added = candidate.filter((property) => !baselineSet.has(property)).map(() => 1);
  const removed = baseline.filter((property) => !candidateSet.has(property)).map(() => -1);
  return [...added, ...removed];
}

function uniquePositiveRequirements(
  requirements: ActionPotentialView['positiveEffectRequirements'],
) {
  return requirements.filter(
    (item, index) =>
      requirements.findIndex(
        (candidate) => candidate.metric === item.metric && candidate.stage === item.stage,
      ) === index,
  );
}

function actionTitle(catalog: StageActionCatalog, actionId: string) {
  const action = catalog[actionId];
  if (!action) throw new Error(`Не найдено обязательное действие ${actionId}`);
  return action.title;
}
