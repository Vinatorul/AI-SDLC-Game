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
    expect(forecast.stageChanges).toEqual(
      stageKeys.flatMap((stage) =>
        snapshot.stages[stage] === plan.stages[stage] ? [] : [{ stage, state: plan.stages[stage] }],
      ),
    );
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
