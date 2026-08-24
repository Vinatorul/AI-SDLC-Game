import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultScenario } from '@ai-sdlc/game-engine';
import { afterEach, describe, expect, it } from 'vitest';
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
});

function temporaryFile(content: string) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-scenario-'));
  directories.push(directory);
  const filename = join(directory, 'scenario.json');
  writeFileSync(filename, content);
  return filename;
}
