import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaSql } from './schema';

export type GameDatabase = DatabaseSync;

export function openDatabase(filename: string): GameDatabase {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const database = new DatabaseSync(filename);
  configureDatabase(database);
  database.exec(schemaSql);
  return database;
}

function configureDatabase(database: GameDatabase) {
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  database.exec('PRAGMA synchronous = NORMAL');
  if (database.location() !== ':memory:') database.exec('PRAGMA journal_mode = WAL');
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
