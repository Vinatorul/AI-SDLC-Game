import type { GameRules, ScenarioPresentation, StageState } from '@ai-sdlc/contracts';
import type { GameMechanics, ScenarioMechanics } from '@ai-sdlc/game-engine';
import legacySource from '../../../content/legacy-presentation.json';
import type { GameRow } from './db/store';

export const legacyPresentation: ScenarioPresentation = legacySource;

type LegacyRules = Omit<GameRules, 'minReadyStagesToWin'> & { minAiStagesToWin: number };
export type StoredScenarioMechanics = GameMechanics &
  Partial<Pick<ScenarioMechanics, 'metricDefinitions' | 'metricScaleDescription'>> & {
    initialStages: Record<string, StageState>;
    presentation: ScenarioPresentation;
  };

function normalizedRules(source: GameRules | LegacyRules): GameRules {
  if ('minReadyStagesToWin' in source) return source;
  const { minAiStagesToWin, ...rules } = source;
  return { ...rules, minReadyStagesToWin: minAiStagesToWin };
}

function legacyInitialStages(): Record<string, StageState> {
  return Object.fromEntries(legacyPresentation.stages.map(({ id }) => [id, 'AS_IS']));
}

export function storedRules(json: string): GameRules {
  return normalizedRules(JSON.parse(json) as GameRules | LegacyRules);
}

export function storedMechanics(game: Pick<GameRow, 'mechanics_json'>): StoredScenarioMechanics {
  const mechanics = JSON.parse(game.mechanics_json) as StoredScenarioMechanics;
  return {
    ...mechanics,
    initialStages: mechanics.initialStages ?? legacyInitialStages(),
    presentation: mechanics.presentation ?? legacyPresentation,
  };
}

export function upgradeLegacyScenario(source: unknown): unknown {
  if (!source || typeof source !== 'object' || !('schemaVersion' in source)) return source;
  if (source.schemaVersion !== 4) return source;
  const legacy = source as { mechanics: GameMechanics; rules: LegacyRules; schemaVersion: 4 };
  return {
    ...source,
    mechanics: { ...legacy.mechanics, initialStages: legacyInitialStages() },
    presentation: legacyPresentation,
    rules: normalizedRules(legacy.rules),
    schemaVersion: 5,
  };
}
