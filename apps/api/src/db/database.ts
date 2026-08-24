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
  migrateGameSnapshots(database);
  return database;
}

function configureDatabase(database: GameDatabase) {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA synchronous = NORMAL');
  if (database.location() !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
}

function migrateGameSnapshots(database: GameDatabase) {
  withTransaction(database, () => {
    const columns = database.prepare('PRAGMA table_info(games)').all() as unknown as {
      name: string;
    }[];
    if (!columns.some((column) => column.name === 'mechanics_json')) {
      database.exec('ALTER TABLE games ADD COLUMN mechanics_json TEXT');
    }
    if (!columns.some((column) => column.name === 'scenario_id')) {
      database.exec('ALTER TABLE games ADD COLUMN scenario_id TEXT');
    }
    database
      .prepare('UPDATE games SET mechanics_json = ? WHERE mechanics_json IS NULL')
      .run(legacyMechanicsJson);
    database.exec("UPDATE games SET scenario_id = 'technical-mvp' WHERE scenario_id IS NULL");
  });
}

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
