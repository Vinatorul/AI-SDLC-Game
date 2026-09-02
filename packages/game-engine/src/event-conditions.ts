import type { ForecastPredicateView, ProcessProperty } from '@ai-sdlc/contracts';
import type {
  CountRange,
  EngineAction,
  EngineSnapshot,
  EventRule,
  StageActionCatalog,
} from './types';

export function evaluateEventRule(
  rule: EventRule,
  action: EngineAction,
  snapshot: EngineSnapshot,
  catalog: StageActionCatalog,
) {
  if (rule.actionIds && !rule.actionIds.includes(action.id)) {
    return { conditions: [], matched: false };
  }
  const conditions = eventConditions(rule, action, snapshot, catalog);
  return { conditions, matched: conditions.every(({ satisfied }) => satisfied) };
}

export function eventRuleMatches(rule: EventRule, action: EngineAction, snapshot: EngineSnapshot) {
  if (rule.actionIds && !rule.actionIds.includes(action.id)) return false;
  return eventConditions(rule, action, snapshot).every(({ satisfied }) => satisfied);
}

function eventConditions(
  rule: EventRule,
  action: EngineAction,
  snapshot: EngineSnapshot,
  catalog?: StageActionCatalog,
) {
  const resulting = new Set([...snapshot.properties, ...action.addProperties]);
  return [
    ...propertyConditions(rule, snapshot, resulting),
    ...actionHistoryConditions(rule, snapshot, catalog),
    ...stageStateConditions(rule, snapshot),
    ...countConditions(rule, snapshot, catalog),
  ];
}

function propertyConditions(
  rule: EventRule,
  snapshot: EngineSnapshot,
  resulting: Set<ProcessProperty>,
): ForecastPredicateView[] {
  return [
    propertyCondition(rule.hasProperty, 'PRESENT', 'BEFORE_ACTION', snapshot.properties),
    propertyCondition(rule.missingProperty, 'ABSENT', 'BEFORE_ACTION', snapshot.properties),
    propertyCondition(rule.hasResultingProperty, 'PRESENT', 'AFTER_ACTION', [...resulting]),
    propertyCondition(rule.missingResultingProperty, 'ABSENT', 'AFTER_ACTION', [...resulting]),
  ].flatMap((condition) => (condition ? [condition] : []));
}

function propertyCondition(
  property: ProcessProperty | undefined,
  expected: 'ABSENT' | 'PRESENT',
  timing: 'AFTER_ACTION' | 'BEFORE_ACTION',
  properties: ProcessProperty[],
): ForecastPredicateView | null {
  if (!property) return null;
  const present = properties.includes(property);
  return {
    expected,
    kind: 'PROPERTY',
    property,
    satisfied: present === (expected === 'PRESENT'),
    timing,
  };
}

function actionHistoryConditions(
  rule: EventRule,
  snapshot: EngineSnapshot,
  catalog?: StageActionCatalog,
): ForecastPredicateView[] {
  const applied = new Set(snapshot.appliedActions.map(({ actionId }) => actionId));
  return [
    actionHistoryCondition(rule.hasAppliedActions, 'APPLIED', applied, catalog),
    actionHistoryCondition(rule.missingAppliedActions, 'NOT_APPLIED', applied, catalog),
  ].flatMap((condition) => (condition ? [condition] : []));
}

function actionHistoryCondition(
  actionIds: string[] | undefined,
  expected: 'APPLIED' | 'NOT_APPLIED',
  applied: Set<string>,
  catalog?: StageActionCatalog,
): ForecastPredicateView | null {
  if (!actionIds) return null;
  const statuses = actionIds.map((id) => applied.has(id));
  const satisfied =
    expected === 'APPLIED' ? statuses.every(Boolean) : statuses.every((item) => !item);
  return {
    actionIds,
    expected,
    kind: 'ACTION_HISTORY',
    satisfied,
    titles: actionTitles(actionIds, catalog),
  };
}

function stageStateConditions(rule: EventRule, snapshot: EngineSnapshot): ForecastPredicateView[] {
  return (rule.stageStates ?? []).map(({ stage, state }) => ({
    expected: state,
    kind: 'STAGE_STATE',
    satisfied: snapshot.stages[stage] === state,
    stage,
  }));
}

function countConditions(
  rule: EventRule,
  snapshot: EngineSnapshot,
  catalog?: StageActionCatalog,
): ForecastPredicateView[] {
  return [
    ...totalCountConditions(rule, snapshot),
    ...actionCountConditions(rule, snapshot, catalog),
    ...stageCountConditions(rule, snapshot),
    ...stageSinceCountConditions(rule, snapshot, catalog),
  ];
}

function totalCountConditions(rule: EventRule, snapshot: EngineSnapshot): ForecastPredicateView[] {
  if (!rule.appliedActionCount) return [];
  return [
    countView(snapshot.appliedActions.length, rule.appliedActionCount, { kind: 'ALL_ACTIONS' }),
  ];
}

function actionCountConditions(
  rule: EventRule,
  snapshot: EngineSnapshot,
  catalog?: StageActionCatalog,
): ForecastPredicateView[] {
  return (rule.appliedActionCounts ?? []).map(({ actionIds, ...range }) => {
    const relevant = new Set(actionIds);
    const actual = snapshot.appliedActions.filter(({ actionId }) => relevant.has(actionId)).length;
    return countView(actual, range, {
      actionIds,
      kind: 'ACTIONS',
      titles: actionTitles(actionIds, catalog),
    });
  });
}

function stageCountConditions(rule: EventRule, snapshot: EngineSnapshot): ForecastPredicateView[] {
  return (rule.stageActionCounts ?? []).map(({ stage, ...range }) => {
    const actual = snapshot.appliedActions.filter((action) => action.stage === stage).length;
    return countView(actual, range, { kind: 'STAGE', stage });
  });
}

function stageSinceCountConditions(
  rule: EventRule,
  snapshot: EngineSnapshot,
  catalog?: StageActionCatalog,
): ForecastPredicateView[] {
  return (rule.stageActionCountsSinceLast ?? []).map(
    ({ actionIds, sinceStage, stage, ...range }) => {
      const { actual, sinceStageSeen } = actionsSinceLast(snapshot, stage, sinceStage, actionIds);
      const titles = actionIds ? actionTitles(actionIds, catalog) : undefined;
      const scope = {
        actionIds,
        kind: 'STAGE_SINCE_LAST' as const,
        sinceStage,
        sinceStageSeen,
        stage,
        titles,
      };
      return countView(actual, range, scope);
    },
  );
}

function actionsSinceLast(
  snapshot: EngineSnapshot,
  stage: EngineSnapshot['appliedActions'][number]['stage'],
  sinceStage: EngineSnapshot['appliedActions'][number]['stage'],
  actionIds?: string[],
) {
  const lastSince = snapshot.appliedActions.findLastIndex((action) => action.stage === sinceStage);
  const actions =
    lastSince < 0 ? snapshot.appliedActions : snapshot.appliedActions.slice(lastSince + 1);
  const included = actionIds ? new Set(actionIds) : null;
  const actual = actions.filter(
    (item) => item.stage === stage && (!included || included.has(item.actionId)),
  ).length;
  return { actual, sinceStageSeen: lastSince >= 0 };
}

function countView(
  actual: number,
  range: CountRange,
  scope: Extract<ForecastPredicateView, { kind: 'COUNT' }>['scope'],
): ForecastPredicateView {
  return { actual, ...range, kind: 'COUNT', satisfied: countInRange(actual, range), scope };
}

function countInRange(count: number, range: CountRange) {
  if (range.minimum !== undefined && count < range.minimum) return false;
  if (range.maximum !== undefined && count > range.maximum) return false;
  return true;
}

function actionTitles(actionIds: string[], catalog?: StageActionCatalog) {
  if (!catalog) return actionIds;
  return actionIds.map((id) => {
    const action = catalog[id];
    if (!action) throw new Error(`Не найдено действие ${id}`);
    return action.title;
  });
}
