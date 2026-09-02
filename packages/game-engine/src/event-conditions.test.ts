import { describe, expect, it } from 'vitest';
import { evaluateEventRule } from './event-conditions';
import { createInitialMetrics, createInitialStages } from './resolve';
import { defaultScenario } from './scenario';
import type { EngineAction, EngineSnapshot, EventRule } from './types';

describe('event condition explanation', () => {
  it('вычисляет все поддержанные типы условий теми же данными', () => {
    const { action, rule, snapshot } = fixture();
    const result = evaluateEventRule(rule, action, snapshot, defaultScenario.stageActions);
    expect(result.matched).toBe(true);
    expect(result.conditions).toHaveLength(9);
    expect(result.conditions.map(({ kind }) => kind)).toEqual([
      'PROPERTY',
      'PROPERTY',
      'ACTION_HISTORY',
      'ACTION_HISTORY',
      'STAGE_STATE',
      'COUNT',
      'COUNT',
      'COUNT',
      'COUNT',
    ]);
    expect(result.conditions.every(({ satisfied }) => satisfied)).toBe(true);
    const since = result.conditions.find(
      (condition) => condition.kind === 'COUNT' && condition.scope.kind === 'STAGE_SINCE_LAST',
    );
    const policyTitle = defaultScenario.stageActions['review.risk-policy']?.title;
    expect(since).toMatchObject({
      scope: {
        actionIds: ['review.risk-policy'],
        sinceStageSeen: false,
        titles: [policyTitle],
      },
    });
  });

  it('отличает свойство до действия от свойства после него', () => {
    const { action, rule, snapshot } = fixture();
    action.addProperties = ['automatedTests'];
    const result = evaluateEventRule(rule, action, snapshot, defaultScenario.stageActions);
    const resulting = result.conditions.find(
      (condition) => condition.kind === 'PROPERTY' && condition.timing === 'AFTER_ACTION',
    );
    expect(result.matched).toBe(false);
    expect(resulting).toMatchObject({ expected: 'ABSENT', satisfied: false });
  });

  it('отмечает, что отсчёт начался после уже выбранного этапа', () => {
    const { action, snapshot } = fixture();
    snapshot.appliedActions.unshift({
      actionId: 'technicalDiscovery.system-map',
      roundNumber: 1,
      stage: 'technicalDiscovery',
    });
    const event = defaultScenario.rounds[0]?.eventRules.at(-1)?.event;
    if (!event) throw new Error('Нет запасного события');
    const rule: EventRule = {
      event,
      stageActionCountsSinceLast: [
        { minimum: 1, sinceStage: 'technicalDiscovery', stage: 'review' },
      ],
    };
    const result = evaluateEventRule(rule, action, snapshot, defaultScenario.stageActions);
    expect(result.conditions[0]).toMatchObject({
      actual: 1,
      scope: { sinceStageSeen: true },
    });
  });
});

function fixture() {
  const action = scenarioAction('coding.guided-implementation');
  const snapshot = scenarioSnapshot();
  const fallback = defaultScenario.rounds[0]?.eventRules.at(-1)?.event;
  if (!fallback) throw new Error('Нет запасного события');
  const rule: EventRule = {
    actionIds: [action.id],
    appliedActionCount: { maximum: 2, minimum: 1 },
    appliedActionCounts: [{ actionIds: ['review.risk-policy'], minimum: 1 }],
    event: fallback,
    hasAppliedActions: ['review.risk-policy'],
    hasProperty: 'currentContext',
    missingAppliedActions: ['testing.behavior-checks'],
    missingResultingProperty: 'automatedTests',
    stageActionCounts: [{ minimum: 1, stage: 'review' }],
    stageActionCountsSinceLast: [
      {
        actionIds: ['review.risk-policy'],
        minimum: 1,
        sinceStage: 'technicalDiscovery',
        stage: 'review',
      },
    ],
    stageStates: [{ stage: 'review', state: 'BROKEN' }],
  };
  return { action, rule, snapshot };
}

function scenarioAction(actionId: string): EngineAction {
  const action = defaultScenario.stageActions[actionId];
  if (!action) throw new Error(`Нет действия ${actionId}`);
  return { ...structuredClone(action), id: actionId };
}

function scenarioSnapshot(): EngineSnapshot {
  const stages = createInitialStages();
  stages.review = 'BROKEN';
  return {
    appliedActions: [{ actionId: 'review.risk-policy', roundNumber: 1, stage: 'review' }],
    metrics: createInitialMetrics(defaultScenario.mechanics),
    properties: ['currentContext'],
    stages,
  };
}
