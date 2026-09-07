import source from '../../content/scenarios/technical-mvp.json';
import { parseScenario } from '../../packages/game-engine/src/scenario-schema';

export const defaultScenario = parseScenario(source);
export const defaultRules = defaultScenario.rules;
export const metricKeys = Object.keys(defaultScenario.mechanics.initialMetrics);
export const stageKeys = Object.keys(defaultScenario.mechanics.initialStages);
export const processProperties = defaultScenario.presentation.properties.map(({ id }) => id);
