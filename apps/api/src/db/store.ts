import { randomUUID } from 'node:crypto';
import type { DecisionModel, GamePhase, OutcomeReason } from '@ai-sdlc/contracts';
import type {
  EngineOption,
  EventRule,
  ResolutionPlan,
  Scenario,
  ScenarioStageChoice,
} from '@ai-sdlc/game-engine';
import type { GameDatabase } from './database';
import { insertActionCatalog, insertRoundDecision } from './decision-store';

export type GameRow = {
  admin_token_hash: string;
  code: string;
  current_round: number;
  decision_model: DecisionModel;
  id: string;
  mechanics_json: string;
  metrics_json: string;
  outcome_reason: OutcomeReason | null;
  phase: GamePhase;
  properties_json: string;
  revision: number;
  rules_json: string;
  scenario_id: string;
  scenario_version: number;
  stages_json: string;
  transition_version: number;
};

export type RoundRow = {
  applied_at: string | null;
  event_rules_json: string;
  game_id: string;
  id: string;
  pending_plan_json: string | null;
  round_number: number;
  selected_option_id: string | null;
  shown_event_json: string | null;
  situation: string;
  tied_option_ids_json: string;
  title: string;
};

export type OptionRow = {
  id: string;
  option_key: string;
  payload_json: string;
  round_id: string;
};

export type NewGame = Omit<
  GameRow,
  'current_round' | 'outcome_reason' | 'phase' | 'revision' | 'transition_version'
>;

export type GamePatch = Partial<
  Pick<
    GameRow,
    | 'current_round'
    | 'metrics_json'
    | 'outcome_reason'
    | 'phase'
    | 'properties_json'
    | 'stages_json'
  >
>;

export type RoundPatch = Partial<
  Pick<
    RoundRow,
    | 'applied_at'
    | 'pending_plan_json'
    | 'selected_option_id'
    | 'shown_event_json'
    | 'tied_option_ids_json'
  >
>;

export function insertGame(database: GameDatabase, game: NewGame) {
  const sql = `INSERT INTO games (
    id, code, phase, metrics_json, mechanics_json, properties_json, stages_json,
    rules_json, scenario_id, scenario_version, decision_model, admin_token_hash, created_at, updated_at
  ) VALUES (?, ?, 'LOBBY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const now = new Date().toISOString();
  database
    .prepare(sql)
    .run(
      game.id,
      game.code,
      game.metrics_json,
      game.mechanics_json,
      game.properties_json,
      game.stages_json,
      game.rules_json,
      game.scenario_id,
      game.scenario_version,
      game.decision_model,
      game.admin_token_hash,
      now,
      now,
    );
}

export function insertScenario(database: GameDatabase, gameId: string, scenario: Scenario) {
  insertActionCatalog(database, gameId, scenario.stageActions);
  for (const round of scenario.rounds) {
    const roundId = `${gameId}:${round.id}`;
    insertRound(database, gameId, roundId, round);
    insertRoundDecision(database, roundId, round.stageChoices);
  }
}

function insertRound(
  database: GameDatabase,
  gameId: string,
  roundId: string,
  round: Scenario['rounds'][number],
) {
  const sql = `INSERT INTO game_rounds (
    id, game_id, round_number, title, situation, event_rules_json
  ) VALUES (?, ?, ?, ?, ?, ?)`;
  database
    .prepare(sql)
    .run(
      roundId,
      gameId,
      round.number,
      round.title,
      round.situation,
      JSON.stringify(round.eventRules),
    );
}

export function findGameByCode(database: GameDatabase, code: string) {
  return database.prepare('SELECT * FROM games WHERE code = ?').get(code) as GameRow | undefined;
}

export function findGameById(database: GameDatabase, id: string) {
  return database.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
}

export function findRound(database: GameDatabase, gameId: string, roundIndex: number) {
  const sql = 'SELECT * FROM game_rounds WHERE game_id = ? AND round_number = ?';
  return database.prepare(sql).get(gameId, roundIndex + 1) as RoundRow | undefined;
}

export function insertRoundCopy(
  database: GameDatabase,
  gameId: string,
  source: RoundRow,
  roundNumber: number,
  stageChoices: ScenarioStageChoice[],
) {
  const round = {
    eventRules: parseEventRules(source),
    id: `round-${roundNumber}-${randomUUID()}`,
    number: roundNumber,
    situation: source.situation,
    stageChoices,
    title: source.title,
  };
  const roundId = `${gameId}:${round.id}`;
  insertRound(database, gameId, roundId, round);
  insertRoundDecision(database, roundId, stageChoices);
}

export function listOptions(database: GameDatabase, roundId: string) {
  const sql = 'SELECT * FROM round_options WHERE round_id = ? ORDER BY option_key';
  return database.prepare(sql).all(roundId) as unknown as OptionRow[];
}

export function findOption(database: GameDatabase, roundId: string, optionId: string) {
  const sql = 'SELECT * FROM round_options WHERE round_id = ? AND id = ?';
  return database.prepare(sql).get(roundId, optionId) as OptionRow | undefined;
}

export function parseOption(row: OptionRow): EngineOption {
  return JSON.parse(row.payload_json) as EngineOption;
}

export function parseEventRules(round: RoundRow): EventRule[] {
  return JSON.parse(round.event_rules_json) as EventRule[];
}

export function parsePlan(round: RoundRow): ResolutionPlan | null {
  return round.pending_plan_json ? (JSON.parse(round.pending_plan_json) as ResolutionPlan) : null;
}

export function persistGameTransition(database: GameDatabase, game: GameRow, patch: GamePatch) {
  const sql = `UPDATE games SET phase = ?, current_round = ?, metrics_json = ?,
    properties_json = ?, stages_json = ?, outcome_reason = ?, transition_version = transition_version + 1,
    revision = revision + 1, updated_at = ? WHERE id = ? AND transition_version = ?`;
  const result = database
    .prepare(sql)
    .run(
      patch.phase ?? game.phase,
      patch.current_round ?? game.current_round,
      patch.metrics_json ?? game.metrics_json,
      patch.properties_json ?? game.properties_json,
      patch.stages_json ?? game.stages_json,
      patch.outcome_reason === undefined ? game.outcome_reason : patch.outcome_reason,
      new Date().toISOString(),
      game.id,
      game.transition_version,
    );
  return result.changes === 1;
}

export function persistRound(database: GameDatabase, round: RoundRow, patch: RoundPatch) {
  const sql = `UPDATE game_rounds SET selected_option_id = ?, tied_option_ids_json = ?,
    shown_event_json = ?, pending_plan_json = ?, applied_at = ? WHERE id = ?`;
  database
    .prepare(sql)
    .run(
      patch.selected_option_id === undefined ? round.selected_option_id : patch.selected_option_id,
      patch.tied_option_ids_json ?? round.tied_option_ids_json,
      patch.shown_event_json === undefined ? round.shown_event_json : patch.shown_event_json,
      patch.pending_plan_json === undefined ? round.pending_plan_json : patch.pending_plan_json,
      patch.applied_at === undefined ? round.applied_at : patch.applied_at,
      round.id,
    );
}

export function bumpRevision(database: GameDatabase, gameId: string) {
  const sql = `UPDATE games SET revision = revision + 1, updated_at = ? WHERE id = ?`;
  database.prepare(sql).run(new Date().toISOString(), gameId);
  return (findGameById(database, gameId) as GameRow).revision;
}

export function insertPlayer(
  database: GameDatabase,
  gameId: string,
  name: string,
  tokenHash: string,
) {
  const id = randomUUID();
  const sql =
    'INSERT INTO players (id, game_id, name, token_hash, joined_at) VALUES (?, ?, ?, ?, ?)';
  database.prepare(sql).run(id, gameId, name, tokenHash, new Date().toISOString());
  return id;
}

export function findPlayerByToken(database: GameDatabase, gameId: string, tokenHash: string) {
  const sql = 'SELECT id FROM players WHERE game_id = ? AND token_hash = ?';
  return database.prepare(sql).get(gameId, tokenHash) as { id: string } | undefined;
}

export function findVoteOption(database: GameDatabase, roundId: string, playerId: string) {
  const sql = 'SELECT option_id FROM votes WHERE round_id = ? AND player_id = ?';
  const row = database.prepare(sql).get(roundId, playerId) as { option_id: string } | undefined;
  return row?.option_id ?? null;
}

export function upsertVote(
  database: GameDatabase,
  roundId: string,
  playerId: string,
  optionId: string,
) {
  const sql = `INSERT INTO votes (round_id, player_id, option_id, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(round_id, player_id)
    DO UPDATE SET option_id = excluded.option_id, updated_at = excluded.updated_at`;
  database.prepare(sql).run(roundId, playerId, optionId, new Date().toISOString());
}

export function listVoteCounts(database: GameDatabase, roundId: string) {
  const sql = `SELECT option_id, COUNT(*) AS count FROM votes
    WHERE round_id = ? GROUP BY option_id ORDER BY option_id`;
  return database.prepare(sql).all(roundId) as unknown as { count: number; option_id: string }[];
}

export function countPlayers(database: GameDatabase, gameId: string) {
  const row = database
    .prepare('SELECT COUNT(*) AS count FROM players WHERE game_id = ?')
    .get(gameId);
  return Number((row as { count: number }).count);
}

export function insertAction(
  database: GameDatabase,
  gameId: string,
  revision: number,
  kind: string,
  payload: unknown,
) {
  const sql = `INSERT INTO action_log (game_id, revision, kind, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?)`;
  database
    .prepare(sql)
    .run(gameId, revision, kind, JSON.stringify(payload), new Date().toISOString());
}
