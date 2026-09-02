import { metricKeys, stageKeys } from '@ai-sdlc/contracts';
import { describe, expect, it } from 'vitest';
import { forecastAction, forecastStage } from './forecast';
import {
  createInitialMetrics,
  createInitialStages,
  getAvailableActions,
  resolveRound,
} from './resolve';
import { defaultScenario } from './scenario';
import type { EngineSnapshot } from './types';

describe('admin forecast', () => {
  it('возвращает для действия фактические баллы и итоговые изменения этапов', () => {
    const { catalog, mechanics, round, snapshot } = setup();
    const choice = round.stageChoices.find(({ stage }) => stage === 'technicalDiscovery');
    if (!choice) throw new Error('Нет технической проработки');
    const action = getAvailableActions(catalog, choice, snapshot)[0];
    if (!action) throw new Error('Нет доступного решения');
    const plan = resolveRound(snapshot, round, action, mechanics, catalog);
    const forecast = forecastAction(snapshot, round, action, mechanics, catalog);
    expect(forecast.metricDelta).toEqual(plan.breakdown.applied);
    expect(forecast.activationRequirements).toEqual([]);
    expect(forecast.stageChanges).toEqual(
      stageKeys.flatMap((stage) =>
        snapshot.stages[stage] === plan.stages[stage] ? [] : [{ stage, state: plan.stages[stage] }],
      ),
    );
  });

  it('показывает, какие обязательные действия уже выполнены', () => {
    const { catalog, mechanics, round, snapshot } = setup();
    const action = catalog['coding.repository-mcp'];
    if (!action) throw new Error('Нет MCP для репозитория');
    snapshot.appliedActions = [
      { actionId: 'testing.behavior-checks', roundNumber: 1, stage: 'testing' },
    ];
    const forecast = forecastAction(
      snapshot,
      round,
      { ...action, id: 'coding.repository-mcp' },
      mechanics,
      catalog,
    );
    expect(forecast.activationRequirements).toEqual([
      expect.objectContaining({ actionId: 'productDiscovery.requirement-draft', satisfied: false }),
      expect.objectContaining({ actionId: 'testing.behavior-checks', satisfied: true }),
      expect.objectContaining({ actionId: 'coding.project-checks', satisfied: false }),
    ]);
  });

  it('объясняет выбранную ветку и условия, которые её опередили', () => {
    const { catalog, mechanics, round, snapshot } = setup();
    const action = catalog['coding.change-from-description'];
    if (!action) throw new Error('Нет рискованного изменения кода');
    const forecast = forecastAction(
      snapshot,
      round,
      { ...action, id: 'coding.change-from-description' },
      mechanics,
      catalog,
    );
    const selected = forecast.eventBranches.find(({ selected }) => selected);
    expect(selected).toMatchObject({
      eventId: 'event-stale-description-reached-next-stage',
      influence: 'WORSENS',
      matched: true,
    });
    expect(selected?.conditions).toEqual([
      expect.objectContaining({ expected: 'NOT_APPLIED', kind: 'ACTION_HISTORY', satisfied: true }),
    ]);
  });

  it('отличает совпавшую ветку от первой выбранной', () => {
    const { catalog, mechanics, round, snapshot } = setup();
    snapshot.appliedActions = [
      { actionId: 'testing.behavior-checks', roundNumber: 1, stage: 'testing' },
    ];
    const source = catalog['coding.change-from-description'];
    if (!source) throw new Error('Нет рискованного изменения кода');
    const forecast = forecastAction(
      snapshot,
      round,
      { ...source, id: 'coding.change-from-description' },
      mechanics,
      catalog,
    );
    const caught = forecast.eventBranches.find(({ eventId }) =>
      eventId.includes('caught-by-tests'),
    );
    const later = forecast.eventBranches.find(({ eventId }) =>
      eventId.includes('reached-next-stage'),
    );
    expect(caught).toMatchObject({ matched: true, selected: true });
    expect(later).toMatchObject({ matched: true, selected: false });
  });

  it('показывает сломанный этап, который блокирует положительный эффект', () => {
    const { catalog, mechanics, round, snapshot } = setup();
    snapshot.stages.review = 'BROKEN';
    const source = catalog['coding.parallel-agents'];
    if (!source) throw new Error('Нет параллельного написания кода');
    const forecast = forecastAction(
      snapshot,
      round,
      { ...source, id: 'coding.parallel-agents' },
      mechanics,
      catalog,
    );
    expect(forecast.positiveEffectRequirements).toContainEqual({
      metric: 'deliverySpeed',
      satisfied: false,
      stage: 'review',
    });
  });

  it('собирает диапазон только из доступных сейчас решений этапа', () => {
    const { catalog, mechanics, round, snapshot } = setup();
    const choice = round.stageChoices.find(({ stage }) => stage === 'technicalDiscovery');
    if (!choice) throw new Error('Нет технической проработки');
    const actions = getAvailableActions(catalog, choice, snapshot);
    const forecasts = actions.map((action) =>
      forecastAction(snapshot, round, action, mechanics, catalog),
    );
    const stage = forecastStage(snapshot, round, choice, mechanics, catalog);
    expect(stage.actionCount).toBe(actions.length);
    for (const metric of metricKeys) {
      const values = forecasts.map(({ metricDelta }) => metricDelta[metric] ?? 0);
      expect(stage.metricRanges[metric]).toEqual({
        maximum: Math.max(...values),
        minimum: Math.min(...values),
      });
    }
  });
});

function setup() {
  const snapshot: EngineSnapshot = {
    appliedActions: [],
    metrics: createInitialMetrics(defaultScenario.mechanics),
    properties: [],
    stages: createInitialStages(),
  };
  return {
    catalog: defaultScenario.stageActions,
    mechanics: defaultScenario.mechanics,
    round: defaultScenario.rounds[0] as (typeof defaultScenario.rounds)[number],
    snapshot,
  };
}
