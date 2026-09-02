import {
  type ActionPotentialView,
  metricKeys,
  type StageKey,
  type StagePotentialView,
  type StageState,
  stageKeys,
} from '@ai-sdlc/contracts';
import { getAvailableActions, resolveRound } from './resolve';
import type {
  EngineAction,
  EngineSnapshot,
  GameMechanics,
  ScenarioRound,
  ScenarioStageChoice,
  StageActionCatalog,
} from './types';

export function forecastAction(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  action: EngineAction,
  mechanics: GameMechanics,
  catalog: StageActionCatalog,
): ActionPotentialView {
  const plan = resolveRound(snapshot, round, action, mechanics, catalog);
  return {
    actionId: action.id,
    metricDelta: plan.breakdown.applied ?? plan.breakdown.total,
    stageChanges: changedStages(snapshot.stages, plan.stages),
  };
}

export function forecastStage(
  snapshot: EngineSnapshot,
  round: ScenarioRound,
  choice: ScenarioStageChoice,
  mechanics: GameMechanics,
  catalog: StageActionCatalog,
): StagePotentialView {
  const actions = getAvailableActions(catalog, choice, snapshot);
  const potentials = actions.map((action) =>
    forecastAction(snapshot, round, action, mechanics, catalog),
  );
  return {
    actionCount: potentials.length,
    metricRanges: metricRanges(potentials),
    stage: choice.stage,
    stageChanges: possibleStageChanges(potentials, snapshot),
  };
}

function changedStages(before: Record<StageKey, StageState>, after: Record<StageKey, StageState>) {
  return stageKeys.flatMap((stage) =>
    before[stage] === after[stage] ? [] : [{ stage, state: after[stage] }],
  );
}

function metricRanges(actions: ActionPotentialView[]) {
  return Object.fromEntries(
    metricKeys.map((metric) => {
      const values = actions.map(({ metricDelta }) => metricDelta[metric] ?? 0);
      return [metric, range(values)];
    }),
  ) as StagePotentialView['metricRanges'];
}

function range(values: number[]) {
  if (values.length === 0) return { maximum: 0, minimum: 0 };
  return { maximum: Math.max(...values), minimum: Math.min(...values) };
}

function possibleStageChanges(actions: ActionPotentialView[], snapshot: EngineSnapshot) {
  return stageKeys.flatMap((stage) => {
    const affected = actions.some(({ stageChanges }) =>
      stageChanges.some((change) => change.stage === stage),
    );
    if (!affected) return [];
    const states = actions.map((action) => finalState(action, stage, snapshot));
    return [{ stage, states: [...new Set(states)] }];
  });
}

function finalState(action: ActionPotentialView, stage: StageKey, snapshot: EngineSnapshot) {
  return (
    action.stageChanges.find((change) => change.stage === stage)?.state ?? snapshot.stages[stage]
  );
}
