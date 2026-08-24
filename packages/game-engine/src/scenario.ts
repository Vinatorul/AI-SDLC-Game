import scenarioSource from '../content/scenarios/technical-mvp.json';
import { parseScenario } from './scenario-schema';

export const defaultScenario = parseScenario(scenarioSource);
export const defaultRules = defaultScenario.rules;
