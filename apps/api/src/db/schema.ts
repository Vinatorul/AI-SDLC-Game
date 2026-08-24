export const schemaSql = `
CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  phase TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL,
  mechanics_json TEXT NOT NULL,
  properties_json TEXT NOT NULL,
  stages_json TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_version INTEGER NOT NULL,
  transition_version INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0,
  admin_token_hash TEXT NOT NULL,
  outcome_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_rounds (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  situation TEXT NOT NULL,
  event_rules_json TEXT NOT NULL,
  selected_option_id TEXT,
  tied_option_ids_json TEXT NOT NULL DEFAULT '[]',
  shown_event_json TEXT,
  pending_plan_json TEXT,
  applied_at TEXT,
  UNIQUE(game_id, round_number)
);

CREATE TABLE IF NOT EXISTS round_options (
  round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  option_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY(round_id, id),
  UNIQUE(round_id, option_key)
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  joined_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS votes (
  round_id TEXT NOT NULL REFERENCES game_rounds(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(round_id, player_id),
  FOREIGN KEY(round_id, option_id) REFERENCES round_options(round_id, id)
);

CREATE TABLE IF NOT EXISTS action_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS players_game_idx ON players(game_id);
CREATE INDEX IF NOT EXISTS rounds_game_idx ON game_rounds(game_id, round_number);
CREATE INDEX IF NOT EXISTS action_log_game_idx ON action_log(game_id, id);
`;
