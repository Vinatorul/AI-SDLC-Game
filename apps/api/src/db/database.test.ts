import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from './database';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { force: true, recursive: true });
});

it('добавляет снимок механики в старую базу', () => {
  const filename = legacyDatabase();
  const database = openDatabase(filename);
  const row = database.prepare('SELECT mechanics_json, scenario_id FROM games').get() as {
    mechanics_json: string;
    scenario_id: string;
  };
  expect(JSON.parse(row.mechanics_json).initialMetrics.quality).toBe(60);
  expect(row.scenario_id).toBe('technical-mvp');
  database.close();
});

function legacyDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-legacy-'));
  directories.push(directory);
  const filename = join(directory, 'game.sqlite');
  const database = new DatabaseSync(filename);
  database.exec(legacySchema);
  database.exec(`INSERT INTO games (
    id, code, phase, metrics_json, properties_json, stages_json, rules_json,
    scenario_version, admin_token_hash, created_at, updated_at
  ) VALUES ('1', 'ABC234', 'LOBBY', '{}', '[]', '{}', '{}', 1, 'hash', 'now', 'now')`);
  database.close();
  return filename;
}

const legacySchema = `
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  stages_json TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  scenario_version INTEGER NOT NULL,
  transition_version INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  admin_token_hash TEXT NOT NULL,
  outcome_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);`;
