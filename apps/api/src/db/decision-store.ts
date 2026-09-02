import { randomUUID } from 'node:crypto';
import type { StageKey } from '@ai-sdlc/contracts';
import type { EngineAction, ScenarioStageChoice, StageAction } from '@ai-sdlc/game-engine';
import type { GameDatabase } from './database';

export type StoredBallotKind = 'ACTION' | 'STAGE';

export type BallotRow = {
  created_at: string;
  game_id: string;
  id: string;
  kind: StoredBallotKind;
  round_id: string;
  selected_choice_id: string | null;
  sequence: number;
  tied_choice_ids_json: string;
};

export type ActionRow = {
  action_id: string;
  game_id: string;
  payload_json: string;
  stage: StageKey;
};

export type AppliedActionRow = {
  action_id: string;
  applied_at: string;
  game_id: string;
  id: number;
  pending_plan_json: string | null;
  round_number: number;
  round_id: string;
  stage: StageKey;
};

export type StageChoiceSpec = ScenarioStageChoice;
export type StoredAction = EngineAction;

export function insertActionCatalog(
  database: GameDatabase,
  gameId: string,
  catalog: Record<string, StageAction>,
) {
  const sql = `INSERT INTO game_action_catalog (game_id, action_id, stage, payload_json)
    VALUES (?, ?, ?, ?)`;
  const statement = database.prepare(sql);
  for (const [actionId, action] of Object.entries(catalog)) {
    statement.run(gameId, actionId, action.stage, JSON.stringify({ ...action, id: actionId }));
  }
}

export function insertRoundDecision(
  database: GameDatabase,
  roundId: string,
  stageChoices: StageChoiceSpec[],
) {
  const sql = 'INSERT INTO round_decisions (round_id, payload_json) VALUES (?, ?)';
  database.prepare(sql).run(roundId, JSON.stringify({ stageChoices }));
}

export function findRoundDecision(database: GameDatabase, roundId: string) {
  const sql = 'SELECT payload_json FROM round_decisions WHERE round_id = ?';
  const row = database.prepare(sql).get(roundId) as { payload_json: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.payload_json) as { stageChoices: StageChoiceSpec[] };
}

export function findAction(database: GameDatabase, gameId: string, actionId: string) {
  const sql = 'SELECT * FROM game_action_catalog WHERE game_id = ? AND action_id = ?';
  return database.prepare(sql).get(gameId, actionId) as ActionRow | undefined;
}

export function listActions(database: GameDatabase, gameId: string) {
  const sql = 'SELECT * FROM game_action_catalog WHERE game_id = ? ORDER BY action_id';
  return database.prepare(sql).all(gameId) as unknown as ActionRow[];
}

export function parseAction(row: ActionRow): StoredAction {
  return JSON.parse(row.payload_json) as StoredAction;
}

export function createBallot(
  database: GameDatabase,
  gameId: string,
  roundId: string,
  kind: StoredBallotKind,
  choiceIds: string[],
) {
  const ballotId = randomUUID();
  const sequence = kind === 'STAGE' ? 1 : 2;
  const sql = `INSERT INTO ballots (id, game_id, round_id, kind, sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`;
  database.prepare(sql).run(ballotId, gameId, roundId, kind, sequence, new Date().toISOString());
  insertBallotChoices(database, ballotId, choiceIds);
  return findBallotById(database, ballotId) as BallotRow;
}

function insertBallotChoices(database: GameDatabase, ballotId: string, choiceIds: string[]) {
  const sql = 'INSERT INTO ballot_choices (ballot_id, choice_id, position) VALUES (?, ?, ?)';
  const statement = database.prepare(sql);
  choiceIds.forEach((choiceId, index) => {
    statement.run(ballotId, choiceId, index);
  });
}

export function findBallotById(database: GameDatabase, ballotId: string) {
  return database.prepare('SELECT * FROM ballots WHERE id = ?').get(ballotId) as
    | BallotRow
    | undefined;
}

export function findCurrentBallot(database: GameDatabase, roundId: string) {
  const sql = 'SELECT * FROM ballots WHERE round_id = ? ORDER BY sequence DESC LIMIT 1';
  return database.prepare(sql).get(roundId) as BallotRow | undefined;
}

export function findBallotByKind(database: GameDatabase, roundId: string, kind: StoredBallotKind) {
  const sql = 'SELECT * FROM ballots WHERE round_id = ? AND kind = ?';
  return database.prepare(sql).get(roundId, kind) as BallotRow | undefined;
}

export function listBallotChoiceIds(database: GameDatabase, ballotId: string) {
  const sql = 'SELECT choice_id FROM ballot_choices WHERE ballot_id = ? ORDER BY position';
  const rows = database.prepare(sql).all(ballotId) as unknown as { choice_id: string }[];
  return rows.map((row) => row.choice_id);
}

export function persistBallotResult(
  database: GameDatabase,
  ballot: BallotRow,
  selectedChoiceId: string | null,
  tiedChoiceIds: string[],
) {
  const sql = `UPDATE ballots SET selected_choice_id = ?, tied_choice_ids_json = ? WHERE id = ?`;
  database.prepare(sql).run(selectedChoiceId, JSON.stringify(tiedChoiceIds), ballot.id);
}

export function upsertBallotVote(
  database: GameDatabase,
  ballotId: string,
  playerId: string,
  choiceId: string,
) {
  const sql = `INSERT INTO ballot_votes (ballot_id, player_id, choice_id, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(ballot_id, player_id)
    DO UPDATE SET choice_id = excluded.choice_id, updated_at = excluded.updated_at`;
  database.prepare(sql).run(ballotId, playerId, choiceId, new Date().toISOString());
}

export function findBallotVote(database: GameDatabase, ballotId: string, playerId: string) {
  const sql = 'SELECT choice_id FROM ballot_votes WHERE ballot_id = ? AND player_id = ?';
  const row = database.prepare(sql).get(ballotId, playerId) as { choice_id: string } | undefined;
  return row?.choice_id ?? null;
}

export function listBallotVoteCounts(database: GameDatabase, ballotId: string) {
  const sql = `SELECT choice_id, COUNT(*) AS count FROM ballot_votes
    WHERE ballot_id = ? GROUP BY choice_id ORDER BY choice_id`;
  return database.prepare(sql).all(ballotId) as unknown as { choice_id: string; count: number }[];
}

export function listAppliedActions(database: GameDatabase, gameId: string) {
  const sql = `SELECT applied_actions.*, game_rounds.round_number, game_rounds.pending_plan_json
    FROM applied_actions
    JOIN game_rounds ON game_rounds.id = applied_actions.round_id
    WHERE applied_actions.game_id = ? ORDER BY applied_actions.id`;
  return database.prepare(sql).all(gameId) as unknown as AppliedActionRow[];
}

export function insertAppliedAction(
  database: GameDatabase,
  gameId: string,
  roundId: string,
  actionId: string,
  stage: StageKey,
) {
  const sql = `INSERT INTO applied_actions (game_id, round_id, action_id, stage, applied_at)
    VALUES (?, ?, ?, ?, ?)`;
  database.prepare(sql).run(gameId, roundId, actionId, stage, new Date().toISOString());
}
