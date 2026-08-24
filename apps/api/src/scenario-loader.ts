import { readFileSync } from 'node:fs';
import { defaultScenario, parseScenario, type Scenario } from '@ai-sdlc/game-engine';

export function loadScenario(filename?: string): Scenario {
  if (!filename) return defaultScenario;
  try {
    const source = JSON.parse(readFileSync(filename, 'utf8')) as unknown;
    return parseScenario(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Не удалось загрузить сценарий ${filename}: ${message}`, { cause: error });
  }
}
