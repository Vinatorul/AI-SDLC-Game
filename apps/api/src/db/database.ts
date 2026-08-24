import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql } from './schema';

export type GameDatabase = DatabaseSync;

// Frozen compatibility snapshot for databases created before mechanics_json existed.
// Active balance belongs only in the scenario JSON; do not update this when that balance changes.
const legacyMechanicsJson = JSON.stringify({
  initialMetrics: { controllability: 60, deliverySpeed: 60, quality: 60, teamCapacity: 60 },
  metricBounds: { maximum: 100, minimum: 0 },
  propertyEffects: {
    automatedTests: { controllability: 1, deliverySpeed: 1, quality: 3 },
    currentContext: { deliverySpeed: 1, quality: 2 },
    humanReview: { controllability: 1, quality: 2, teamCapacity: -1 },
    observability: { controllability: 3, teamCapacity: 1 },
    rollback: { controllability: 2, deliverySpeed: 1 },
  },
});

export function openDatabase(filename: string): GameDatabase {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  configureDatabase(database);
  database.exec(schemaSql);
  runMigrations(database);
  database.exec('PRAGMA optimize');
  return database;
}

function configureDatabase(database: GameDatabase) {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA synchronous = NORMAL');
  if (database.location() !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
}

function runMigrations(database: GameDatabase) {
  const migrations = [migrateGameSnapshots, migrateDecisionBallots, migrateDecisionModelName];
  const current = Number(database.prepare('PRAGMA user_version').get()?.user_version ?? 0);
  for (let index = current; index < migrations.length; index += 1) {
    withTransaction(database, () => {
      migrations[index]?.(database);
      database.exec(`PRAGMA user_version = ${index + 1}`);
    });
  }
}

function migrateGameSnapshots(database: GameDatabase) {
  addColumn(database, 'games', 'mechanics_json', 'TEXT');
  addColumn(database, 'games', 'scenario_id', 'TEXT');
  database
    .prepare('UPDATE games SET mechanics_json = ? WHERE mechanics_json IS NULL')
    .run(legacyMechanicsJson);
  database.exec("UPDATE games SET scenario_id = 'technical-mvp' WHERE scenario_id IS NULL");
}

function migrateDecisionBallots(database: GameDatabase) {
  addColumn(database, 'games', 'decision_model', "TEXT NOT NULL DEFAULT 'SINGLE_OPTION_V1'");
  database.exec(decisionSchemaSql);
}

function migrateDecisionModelName(database: GameDatabase) {
  database.exec(
    "UPDATE games SET decision_model = 'SINGLE_OPTION_V1' WHERE decision_model = 'LEGACY_OPTION'",
  );
}

function addColumn(database: GameDatabase, table: string, column: string, definition: string) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as {
    name: string;
  }[];
  if (!rows.some((row) => row.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const decisionSchemaSql = `
CREATE TABLE IF NOT EXISTS game_action_catalog (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(game_id, action_id)
);

CREATE TABLE IF NOT EXISTS round_decisions (
  round_id TEXT PRIMARY KEY REFERENCES game_rounds(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ballots (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  selected_choice_id TEXT,
  tied_choice_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(round_id, kind)
);

CREATE TABLE IF NOT EXISTS ballot_choices (
  ballot_id TEXT NOT NULL REFERENCES ballots(id) ON DELETE CASCADE,
  choice_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY(ballot_id, choice_id)
);

CREATE TABLE IF NOT EXISTS ballot_votes (
  ballot_id TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  choice_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(ballot_id, player_id),
  FOREIGN KEY(ballot_id, choice_id) REFERENCES ballot_choices(ballot_id, choice_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS applied_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE(round_id)
);

CREATE INDEX IF NOT EXISTS ballots_round_idx ON ballots(round_id, sequence);
CREATE INDEX IF NOT EXISTS applied_actions_game_idx ON applied_actions(game_id, id);
`;

export function withTransaction<T>(database: GameDatabase, operation: () => T): T {
  database.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
