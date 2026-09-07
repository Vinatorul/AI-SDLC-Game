import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultScenario } from './bundled-scenario';
import { legacyPresentation } from './scenario-compatibility';
import { loadScenario } from './scenario-loader';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

describe('loadScenario', () => {
  it('загружает валидный внешний JSON', () => {
    const filename = temporaryFile(JSON.stringify(defaultScenario));
    expect(loadScenario(filename)).toEqual(defaultScenario);
  });

  it('не подменяет повреждённый внешний файл встроенным', () => {
    const filename = temporaryFile('{broken');
    expect(() => loadScenario(filename)).toThrow(`Не удалось загрузить сценарий ${filename}`);
  });

  it('сообщает имя отсутствующего файла', () => {
    expect(() => loadScenario('/missing/scenario.json')).toThrow('/missing/scenario.json');
  });

  it('загружает схему 4 с прежними подписями и правилом победы', () => {
    const { initialStages: _initialStages, ...mechanics } = defaultScenario.mechanics;
    const { minReadyStagesToWin, ...rules } = defaultScenario.rules;
    const legacy = {
      ...defaultScenario,
      mechanics,
      presentation: undefined,
      rules: { ...rules, minAiStagesToWin: minReadyStagesToWin },
      schemaVersion: 4,
    };
    const loaded = loadScenario(temporaryFile(JSON.stringify(legacy)));
    expect(loaded.schemaVersion).toBe(5);
    expect(loaded.presentation).toEqual(legacyPresentation);
    expect(loaded.mechanics.initialStages).toEqual(defaultScenario.mechanics.initialStages);
    expect(loaded.rules.minReadyStagesToWin).toBe(minReadyStagesToWin);
    expect(loaded.rules).not.toHaveProperty('minAiStagesToWin');
  });
});

function temporaryFile(content: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-scenario-'));
  directories.push(directory);
  const filename = join(directory, 'scenario.json');
  writeFileSync(filename, content);
  return filename;
}
