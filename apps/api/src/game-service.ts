import { randomUUID } from 'node:crypto';
import type {
  AdminCommand,
  CreateGameResponse,
  GameRules,
  GameState,
  JoinGameResponse,
  MetricValues,
  ProcessProperty,
  StageKey,
  StageState,
  VoteResponse,
} from '@ai-sdlc/contracts';
import {
  createInitialMetrics,
  createInitialStages,
  defaultScenario,
  type EngineSnapshot,
  evaluateOutcome,
  resolveRound,
  type Scenario,
  type ScenarioMechanics,
  type ScenarioRound,
} from '@ai-sdlc/game-engine';
import { createRoomCode, createToken, hashToken, tokenMatches } from './auth';
import type { GameDatabase } from './db/database';
import { withTransaction } from './db/database';
import {
  bumpRevision,
  findGameByCode,
  findGameById,
  findOption,
  findPlayerByToken,
  findRound,
  findVoteOption,
  type GameRow,
  insertAction,
  insertGame,
  insertPlayer,
  insertScenario,
  listOptions,
  listVoteCounts,
  parseEventRules,
  parseOption,
  parsePlan,
  persistGameTransition,
  persistRound,
  type RoundRow,
  upsertVote,
} from './db/store';
import { AppError, assertCondition, assertFound } from './errors';
import type { GameHub } from './realtime/game-hub';
import { buildGameState } from './state';

export class GameService {
  constructor(
    private readonly database: GameDatabase,
    private readonly hub: GameHub,
    private readonly scenario: Scenario = defaultScenario,
  ) {}

  createGame(): CreateGameResponse {
    const id = randomUUID();
    const code = this.availableCode();
    const adminToken = createToken();
    withTransaction(this.database, () => {
      insertGame(this.database, this.newGame(id, code, adminToken));
      insertScenario(this.database, id, this.scenario);
      insertAction(this.database, id, 0, 'GAME_CREATED', { scenario: this.scenario.id });
    });
    return { adminToken, state: this.stateByCode(code) };
  }

  join(code: string, name: string): JoinGameResponse {
    const game = this.gameByCode(code);
    const playerToken = createToken();
    const playerId = withTransaction(this.database, () => {
      const id = insertPlayer(this.database, game.id, name, hashToken(playerToken));
      const revision = bumpRevision(this.database, game.id);
      insertAction(this.database, game.id, revision, 'PLAYER_JOINED', { playerId: id });
      return id;
    });
    const state = this.publishState(game.code, game.id);
    return { playerId, playerToken, state };
  }

  getState(code: string, playerToken?: string): GameState {
    const game = this.gameByCode(code);
    const state = buildGameState(this.database, game);
    return this.stateForPlayer(game, state, playerToken);
  }

  vote(code: string, token: string, optionId: string): VoteResponse {
    const game = this.gameByCode(code);
    withTransaction(this.database, () => this.persistVote(game, token, optionId));
    const state = this.publishState(game.code, game.id);
    return { state: { ...state, myVoteOptionId: optionId } };
  }

  command(code: string, token: string, command: AdminCommand): GameState {
    const game = this.gameByCode(code);
    withTransaction(this.database, () => this.persistCommand(game, token, command));
    return this.publishState(game.code, game.id);
  }

  health() {
    this.database.prepare('SELECT 1').get();
    return { status: 'ok' as const };
  }

  private newGame(id: string, code: string, token: string) {
    return {
      admin_token_hash: hashToken(token),
      code,
      id,
      mechanics_json: JSON.stringify(this.scenario.mechanics),
      metrics_json: JSON.stringify(createInitialMetrics(this.scenario.mechanics)),
      properties_json: '[]',
      rules_json: JSON.stringify(this.scenario.rules),
      scenario_id: this.scenario.id,
      scenario_version: this.scenario.version,
      stages_json: JSON.stringify(createInitialStages()),
    };
  }

  private availableCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = createRoomCode();
      if (!findGameByCode(this.database, code)) return code;
    }
    throw new AppError(503, 'ROOM_CODE_EXHAUSTED', 'Не удалось создать код комнаты');
  }

  private stateByCode(code: string) {
    return buildGameState(this.database, this.gameByCode(code));
  }

  private gameByCode(code: string) {
    return assertFound(findGameByCode(this.database, code.toUpperCase()));
  }

  private publishState(code: string, gameId: string) {
    const game = assertFound(findGameById(this.database, gameId));
    const state = buildGameState(this.database, game);
    this.hub.publish(code, state.revision);
    return state;
  }

  private stateForPlayer(game: GameRow, state: GameState, token: string | undefined) {
    if (!token) return state;
    const player = findPlayerByToken(this.database, game.id, hashToken(token));
    assertCondition(player, 401, 'INVALID_PLAYER_TOKEN', 'Неверный токен игрока');
    if (!state.currentRound) return state;
    const optionId = findVoteOption(this.database, state.currentRound.id, player.id);
    return { ...state, myVoteOptionId: optionId };
  }

  private persistVote(game: GameRow, token: string, optionId: string) {
    const current = assertFound(findGameById(this.database, game.id));
    assertCondition(current.phase === 'VOTING', 409, 'VOTING_CLOSED', 'Голосование закрыто');
    const round = assertFound(findRound(this.database, game.id, current.current_round));
    assertFound(findOption(this.database, round.id, optionId), 'Вариант не найден');
    const player = findPlayerByToken(this.database, game.id, hashToken(token));
    assertCondition(player, 401, 'INVALID_PLAYER_TOKEN', 'Неверный токен игрока');
    upsertVote(this.database, round.id, player.id, optionId);
    const revision = bumpRevision(this.database, game.id);
    insertAction(this.database, game.id, revision, 'VOTE_CHANGED', {
      optionId,
      playerId: player.id,
    });
  }

  private persistCommand(game: GameRow, token: string, command: AdminCommand) {
    const current = assertFound(findGameById(this.database, game.id));
    this.assertAdmin(current, token);
    this.assertVersion(current, command.expectedTransitionVersion);
    this.dispatchCommand(current, command);
    const updated = assertFound(findGameById(this.database, game.id));
    insertAction(this.database, game.id, updated.revision, command.type, command);
  }

  private dispatchCommand(game: GameRow, command: AdminCommand) {
    if (command.type === 'OPEN_VOTING') return this.openVoting(game);
    if (command.type === 'CLOSE_VOTING') return this.closeVoting(game);
    if (command.type === 'RESOLVE_TIE') return this.resolveTie(game, command.optionId);
    if (command.type === 'SHOW_EVENT') return this.showEvent(game);
    if (command.type === 'APPLY_CONSEQUENCES') return this.applyConsequences(game);
    throw new AppError(400, 'UNKNOWN_COMMAND', 'Неизвестная команда');
  }

  private openVoting(game: GameRow) {
    assertCondition(
      game.phase === 'LOBBY' || game.phase === 'FEEDBACK',
      409,
      'INVALID_PHASE',
      'Сейчас нельзя открыть голосование',
    );
    const nextRound = game.phase === 'LOBBY' ? 0 : game.current_round + 1;
    assertCondition(
      nextRound < parseRules(game).roundLimit,
      409,
      'NO_MORE_ROUNDS',
      'Раунды закончились',
    );
    this.persistTransition(game, { current_round: nextRound, phase: 'VOTING' });
  }

  private closeVoting(game: GameRow) {
    assertCondition(game.phase === 'VOTING', 409, 'INVALID_PHASE', 'Голосование уже закрыто');
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const optionIds = listOptions(this.database, round.id).map((option) => option.id);
    const leaders = leaderIds(optionIds, listVoteCounts(this.database, round.id));
    persistRound(this.database, round, {
      selected_option_id: leaders.length === 1 ? leaders[0] : null,
      tied_option_ids_json: JSON.stringify(leaders.length > 1 ? leaders : []),
    });
    this.persistTransition(game, { phase: 'RESULT' });
  }

  private resolveTie(game: GameRow, optionId: string | undefined) {
    assertCondition(game.phase === 'RESULT', 409, 'INVALID_PHASE', 'Сейчас нет ничьей');
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const leaders = JSON.parse(round.tied_option_ids_json) as string[];
    assertCondition(
      optionId && leaders.includes(optionId),
      400,
      'NOT_A_LEADER',
      'Можно выбрать только лидера',
    );
    persistRound(this.database, round, {
      selected_option_id: optionId,
      tied_option_ids_json: '[]',
    });
    this.persistTransition(game, { phase: 'RESULT' });
  }

  private showEvent(game: GameRow) {
    assertCondition(
      game.phase === 'RESULT',
      409,
      'INVALID_PHASE',
      'Сейчас нельзя показать событие',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const optionId = assertFound(round.selected_option_id, 'Победитель ещё не выбран');
    const option = parseOption(assertFound(findOption(this.database, round.id, optionId)));
    const plan = resolveRound(
      engineSnapshot(game),
      scenarioRound(this.database, round),
      option,
      parseMechanics(game),
    );
    persistRound(this.database, round, {
      pending_plan_json: JSON.stringify(plan),
      shown_event_json: JSON.stringify(plan.event),
    });
    this.persistTransition(game, { phase: 'EVENT' });
  }

  private applyConsequences(game: GameRow) {
    assertCondition(game.phase === 'EVENT', 409, 'INVALID_PHASE', 'Последствия уже применены');
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const plan = assertFound(parsePlan(round), 'План последствий не найден');
    const outcome = evaluateOutcome(
      plan.metrics,
      plan.stages,
      game.current_round + 1,
      parseRules(game),
    );
    persistRound(this.database, round, { applied_at: new Date().toISOString() });
    this.persistTransition(game, {
      metrics_json: JSON.stringify(plan.metrics),
      outcome_reason: outcome.reason,
      phase: outcome.phase,
      properties_json: JSON.stringify(plan.properties),
      stages_json: JSON.stringify(plan.stages),
    });
  }

  private persistTransition(game: GameRow, patch: Parameters<typeof persistGameTransition>[2]) {
    const changed = persistGameTransition(this.database, game, patch);
    assertCondition(changed, 409, 'VERSION_CONFLICT', 'Состояние игры уже изменилось');
  }

  private assertAdmin(game: GameRow, token: string) {
    assertCondition(
      tokenMatches(token, game.admin_token_hash),
      401,
      'INVALID_ADMIN_TOKEN',
      'Неверный секрет ведущего',
    );
  }

  private assertVersion(game: GameRow, expected: number) {
    if (game.transition_version === expected) return;
    const state = buildGameState(this.database, game);
    throw new AppError(409, 'VERSION_CONFLICT', 'Состояние игры уже изменилось', state);
  }
}

function leaderIds(optionIds: string[], counts: { count: number; option_id: string }[]) {
  const byOption = new Map(counts.map((item) => [item.option_id, item.count]));
  const maximum = Math.max(0, ...optionIds.map((id) => byOption.get(id) ?? 0));
  return optionIds.filter((id) => (byOption.get(id) ?? 0) === maximum);
}

function engineSnapshot(game: GameRow): EngineSnapshot {
  return {
    metrics: JSON.parse(game.metrics_json) as MetricValues,
    properties: JSON.parse(game.properties_json) as ProcessProperty[],
    stages: JSON.parse(game.stages_json) as Record<StageKey, StageState>,
  };
}

function parseRules(game: GameRow): GameRules {
  return JSON.parse(game.rules_json) as GameRules;
}

function parseMechanics(game: GameRow): ScenarioMechanics {
  return JSON.parse(game.mechanics_json) as ScenarioMechanics;
}

function scenarioRound(database: GameDatabase, round: RoundRow): ScenarioRound {
  return {
    eventRules: parseEventRules(round),
    id: round.id,
    number: round.round_number,
    options: listOptions(database, round.id).map(parseOption),
    situation: round.situation,
    title: round.title,
  };
}
