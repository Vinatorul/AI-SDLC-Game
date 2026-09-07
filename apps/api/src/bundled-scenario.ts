import { parseScenario } from '@ai-sdlc/game-engine';
import bundledSource from '../../../content/scenarios/technical-mvp.json';

export const defaultScenario = parseScenario(bundledSource);
