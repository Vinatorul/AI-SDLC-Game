import type {
  ActionPotentialView,
  StageKey,
  StagePotentialView,
  StageState,
} from '@ai-sdlc/contracts';
import { activationRequirements, eventBranches, positiveRequirements } from './forecast-conditions';
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
    activationRequirements: activationRequirements(action, snapshot, catalog),
    eventBranches: eventBranches({ action, catalog, mechanics, plan, round, snapshot }),
    metricDelta: plan.breakdown.applied ?? plan.breakdown.total,
    positiveEffectRequirements: positiveRequirements(action, plan, mechanics),
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
    metricRanges: metricRanges(potentials, Object.keys(mechanics.initialMetrics)),
    stage: choice.stage,
    stageChanges: possibleStageChanges(potentials, snapshot),
  };
}

function changedStages(before: Record<StageKey, StageState>, after: Record<StageKey, StageState>) {
  return Object.entries(after).flatMap(([stage, state]) =>
    before[stage] === state ? [] : [{ stage, state }],
  );
}

function metricRanges(actions: ActionPotentialView[], metricKeys: string[]) {
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
  return Object.entries(snapshot.stages).flatMap(([stage, state]) => {
    const affected = actions.some(({ stageChanges }) =>
      stageChanges.some((change) => change.stage === stage),
    );
    if (!affected) return [];
    const states = actions.map((action) => finalState(action, stage, state));
    return [{ stage, states: [...new Set(states)] }];
  });
}

function finalState(action: ActionPotentialView, stage: StageKey, current: StageState) {
  return action.stageChanges.find((change) => change.stage === stage)?.state ?? current;
}
