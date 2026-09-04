import { randomUUID } from 'node:crypto';
import type {
  AdminCommand,
  AdminForecast,
  AdminLoginResponse,
  CreateGameRequest,
  CreateGameResponse,
  GameRules,
  GameState,
  JoinGameResponse,
  MetricValues,
  ProcessProperty,
  StageKey,
  StageMutation,
  StageState,
  VoteRequest,
  VoteResponse,
} from '@ai-sdlc/contracts';
import {
  createInitialMetrics,
  createInitialStages,
  defaultScenario,
  type EngineAction,
  type EngineOption,
  type EngineSnapshot,
  evaluateOutcome,
  forecastAction,
  forecastStage,
  type GameMechanics,
  getAvailableActions,
  getAvailableStageChoices,
  resolveRound,
  type Scenario,
  type ScenarioRound,
  type StageActionCatalog,
} from '@ai-sdlc/game-engine';
import { createAdminPassword, createRoomCode, createToken, hashToken, tokenMatches } from './auth';
import type { GameDatabase } from './db/database';
import { withTransaction } from './db/database';
import {
  createBallot,
  findAction,
  findBallotVote,
  findCurrentBallot,
  findRoundDecision,
  insertAppliedAction,
  listActions,
  listAppliedActions,
  listBallotChoiceIds,
  listBallotVoteCounts,
  parseAction,
  persistBallotResult,
  upsertBallotVote,
} from './db/decision-store';
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
  insertRoundCopy,
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
import { shuffledIds } from './shuffle';
import { buildGameState } from './state';

export class GameService {
  constructor(
    private readonly database: GameDatabase,
    private readonly hub: GameHub,
    private readonly scenario: Scenario = defaultScenario,
  ) {}

  createGame(request: CreateGameRequest = {}): CreateGameResponse {
    const id = randomUUID();
    const code = request.code ?? this.availableCode();
    const adminPassword = createAdminPassword();
    withTransaction(this.database, () => {
      if (request.code) this.assertCodeAvailable(code);
      insertGame(this.database, this.newGame(id, code, adminPassword));
      insertScenario(this.database, id, this.scenario);
      insertAction(this.database, id, 0, 'GAME_CREATED', { scenario: this.scenario.id });
    });
    return { adminToken: adminPassword, state: this.stateByCode(code) };
  }

  loginAdmin(code: string, password: string): AdminLoginResponse {
    const game = this.gameByCode(code);
    const adminToken = this.matchingAdminCredential(game, password);
    return { adminToken, state: buildGameState(this.database, game) };
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
    return { playerId, playerToken, state: this.publishState(game.code, game.id) };
  }

  getState(code: string, playerToken?: string): GameState {
    const game = this.gameByCode(code);
    return this.stateForPlayer(game, buildGameState(this.database, game), playerToken);
  }

  getAdminForecast(code: string, token: string): AdminForecast {
    const game = this.gameByCode(code);
    this.assertAdmin(game, token);
    return buildAdminForecast(this.database, game);
  }

  vote(code: string, token: string, request: VoteRequest): VoteResponse {
    const game = this.gameByCode(code);
    withTransaction(this.database, () => this.persistVote(game, token, request));
    const state = this.publishState(game.code, game.id);
    if (request.optionId !== undefined) {
      return {
        state: { ...state, myVoteChoiceId: request.optionId, myVoteOptionId: request.optionId },
      };
    }
    return { state: { ...state, myVoteChoiceId: assertFound(request.choiceId) } };
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
      decision_model: this.scenario.decisionModel,
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
    throw new AppError(
      503,
      'ROOM_CODE_EXHAUSTED',
      'Не получилось создать игру. Попробуйте ещё раз',
    );
  }

  private assertCodeAvailable(code: string) {
    assertCondition(
      !findGameByCode(this.database, code),
      409,
      'ROOM_CODE_TAKEN',
      'Этот код уже занят. Выберите другой',
    );
  }

  private stateByCode(code: string) {
    return buildGameState(this.database, this.gameByCode(code));
  }

  private gameByCode(code: string) {
    return assertFound(findGameByCode(this.database, code.toUpperCase()));
  }

  private publishState(code: string, gameId: string) {
    const state = buildGameState(this.database, assertFound(findGameById(this.database, gameId)));
    this.hub.publish(code, state.revision);
    return state;
  }

  private stateForPlayer(game: GameRow, state: GameState, token: string | undefined) {
    if (!token) return state;
    const player = findPlayerByToken(this.database, game.id, hashToken(token));
    assertCondition(
      player,
      401,
      'INVALID_PLAYER_TOKEN',
      'Не удалось подтвердить вход игрока. Войдите в игру заново',
    );
    if (!state.currentRound || !state.currentBallot) return state;
    if (game.decision_model === 'SINGLE_OPTION_V1') {
      const optionId = findVoteOption(this.database, state.currentRound.id, player.id);
      return { ...state, myVoteChoiceId: optionId, myVoteOptionId: optionId };
    }
    const choiceId = findBallotVote(this.database, state.currentBallot.id, player.id);
    return { ...state, myVoteChoiceId: choiceId };
  }

  private persistVote(game: GameRow, token: string, request: VoteRequest) {
    const current = assertFound(findGameById(this.database, game.id));
    assertCondition(
      current.phase === 'VOTING',
      409,
      'VOTING_CLOSED',
      'Голосование ещё не открыто или уже закрыто',
    );
    const player = findPlayerByToken(this.database, game.id, hashToken(token));
    assertCondition(
      player,
      401,
      'INVALID_PLAYER_TOKEN',
      'Не удалось подтвердить вход игрока. Войдите в игру заново',
    );
    if (current.decision_model === 'SINGLE_OPTION_V1') {
      assertCondition(
        'optionId' in request,
        400,
        'INVALID_VOTE',
        'Выберите вариант, за который хотите проголосовать',
      );
      return this.persistLegacyVote(current, player.id, assertFound(request.optionId));
    }
    assertCondition(
      'ballotId' in request,
      400,
      'INVALID_VOTE',
      'Не удалось определить текущее голосование. Обновите страницу и попробуйте ещё раз',
    );
    return this.persistDecisionVote(
      current,
      player.id,
      assertFound(request.ballotId),
      assertFound(request.choiceId),
    );
  }

  private persistLegacyVote(game: GameRow, playerId: string, optionId: string) {
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    assertFound(findOption(this.database, round.id, optionId), 'Такого варианта в голосовании нет');
    upsertVote(this.database, round.id, playerId, optionId);
    this.logVote(game, playerId, { optionId });
  }

  private persistDecisionVote(game: GameRow, playerId: string, ballotId: string, choiceId: string) {
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const current = assertFound(findCurrentBallot(this.database, round.id));
    assertCondition(
      current.id === ballotId,
      409,
      'STALE_BALLOT',
      'Ведущий уже открыл другое голосование. Обновите страницу и выберите вариант ещё раз',
    );
    const choices = listBallotChoiceIds(this.database, ballotId);
    assertCondition(
      choices.includes(choiceId),
      404,
      'NOT_FOUND',
      'Такого варианта в голосовании нет',
    );
    upsertBallotVote(this.database, ballotId, playerId, choiceId);
    this.logVote(game, playerId, { ballotId, choiceId });
  }

  private logVote(game: GameRow, playerId: string, payload: Record<string, string>) {
    const revision = bumpRevision(this.database, game.id);
    insertAction(this.database, game.id, revision, 'VOTE_CHANGED', { ...payload, playerId });
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
    if (game.decision_model === 'STAGE_ACTION_V2') return this.dispatchDecision(game, command);
    return this.dispatchLegacy(game, command);
  }

  private dispatchDecision(game: GameRow, command: AdminCommand) {
    if (command.type === 'OPEN_VOTING') return this.openStageVoting(game);
    if (command.type === 'OPEN_NEXT_BALLOT') return this.openActionVoting(game);
    if (command.type === 'CLOSE_VOTING') return this.closeDecisionVoting(game);
    if (command.type === 'RESOLVE_TIE') {
      return this.resolveDecisionTie(game, command.choiceId ?? command.optionId);
    }
    if (command.type === 'SHOW_EVENT') return this.showDecisionEvent(game);
    if (command.type === 'APPLY_CONSEQUENCES') return this.applyDecisionConsequences(game);
    throw new AppError(
      400,
      'UNKNOWN_COMMAND',
      'Пульт отправил неизвестную команду. Обновите страницу',
    );
  }

  private dispatchLegacy(game: GameRow, command: AdminCommand) {
    if (command.type === 'OPEN_VOTING') return this.openLegacyVoting(game);
    if (command.type === 'CLOSE_VOTING') return this.closeLegacyVoting(game);
    if (command.type === 'RESOLVE_TIE') {
      return this.resolveLegacyTie(game, command.optionId ?? command.choiceId);
    }
    if (command.type === 'SHOW_EVENT') return this.showLegacyEvent(game);
    if (command.type === 'APPLY_CONSEQUENCES') return this.applyLegacyConsequences(game);
    throw new AppError(
      400,
      'UNKNOWN_COMMAND',
      'Пульт отправил неизвестную команду. Обновите страницу',
    );
  }

  private openStageVoting(game: GameRow) {
    const nextRound = this.nextRound(game);
    const round = assertFound(findRound(this.database, game.id, nextRound));
    const choices = availableStageChoices(this.database, game, round);
    assertCondition(
      choices.length >= 2,
      409,
      'NOT_ENOUGH_STAGES',
      'Нельзя начать голосование: доступно меньше двух этапов',
    );
    createBallot(
      this.database,
      game.id,
      round.id,
      'STAGE',
      choices.map(({ stage }) => stage),
    );
    this.persistTransition(game, { current_round: nextRound, phase: 'VOTING' });
  }

  private openActionVoting(game: GameRow) {
    assertCondition(
      game.phase === 'RESULT',
      409,
      'INVALID_PHASE',
      'Голосование за решение можно открыть только после выбора этапа',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const stageBallot = assertFound(findCurrentBallot(this.database, round.id));
    assertCondition(
      stageBallot.kind === 'STAGE',
      409,
      'INVALID_BALLOT',
      'Голосование за решение уже началось',
    );
    const stage = assertFound(
      stageBallot.selected_choice_id,
      'Сначала завершите голосование за этап',
    ) as StageKey;
    const choice = findStageChoice(this.database, round, stage);
    const actions = getAvailableActions(
      actionCatalog(this.database, game.id),
      choice,
      engineSnapshot(this.database, game),
    );
    assertCondition(
      actions.length > 0,
      409,
      'NO_AVAILABLE_ACTIONS',
      'Для этого этапа не осталось доступных решений',
    );
    const actionIds = actions.map(({ id }) => id);
    const rules = parseRules(game);
    createBallot(
      this.database,
      game.id,
      round.id,
      'ACTION',
      rules.shuffleActionChoices ? shuffledIds(actionIds) : actionIds,
    );
    this.persistTransition(game, { phase: 'VOTING' });
  }

  private closeDecisionVoting(game: GameRow) {
    assertCondition(
      game.phase === 'VOTING',
      409,
      'INVALID_PHASE',
      'Сейчас нет открытого голосования',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const ballot = assertFound(findCurrentBallot(this.database, round.id));
    const choiceIds = listBallotChoiceIds(this.database, ballot.id);
    const leaders = choiceLeaderIds(choiceIds, listBallotVoteCounts(this.database, ballot.id));
    const selected = leaders.length === 1 ? (leaders[0] ?? null) : null;
    persistBallotResult(this.database, ballot, selected, leaders.length > 1 ? leaders : []);
    if (ballot.kind === 'ACTION') persistDecisionRoundResult(this.database, round, leaders);
    this.persistTransition(game, { phase: 'RESULT' });
  }

  private resolveDecisionTie(game: GameRow, choiceId: string | undefined) {
    assertCondition(
      game.phase === 'RESULT',
      409,
      'INVALID_PHASE',
      'Выбрать победителя можно только при ничьей',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const ballot = assertFound(findCurrentBallot(this.database, round.id));
    const leaders = parseIds(ballot.tied_choice_ids_json);
    assertLeader(choiceId, leaders);
    persistBallotResult(this.database, ballot, choiceId as string, []);
    if (ballot.kind === 'ACTION')
      persistDecisionRoundResult(this.database, round, [choiceId as string]);
    this.persistTransition(game, { phase: 'RESULT' });
  }

  private showDecisionEvent(game: GameRow) {
    assertCondition(
      game.phase === 'RESULT',
      409,
      'INVALID_PHASE',
      'Событие можно показать только после выбора победителя',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const ballot = assertFound(findCurrentBallot(this.database, round.id));
    assertCondition(
      ballot.kind === 'ACTION',
      409,
      'INVALID_BALLOT',
      'Сначала завершите голосование за решение',
    );
    const actionId = assertFound(
      ballot.selected_choice_id,
      'Сначала выберите победителя голосования',
    );
    const action = parseAction(assertFound(findAction(this.database, game.id, actionId)));
    const plan = resolveRound(
      engineSnapshot(this.database, game),
      scenarioRound(this.database, round),
      action,
      parseMechanics(game),
      actionCatalog(this.database, game.id),
    );
    persistRound(this.database, round, {
      pending_plan_json: JSON.stringify(plan),
      shown_event_json: JSON.stringify(plan.event),
    });
    this.persistTransition(game, { phase: 'EVENT' });
  }

  private applyDecisionConsequences(game: GameRow) {
    const { plan, round } = this.pendingConsequences(game);
    const ballot = assertFound(findCurrentBallot(this.database, round.id));
    assertCondition(ballot.kind === 'ACTION', 409, 'INVALID_BALLOT', 'Сначала выберите решение');
    const actionId = assertFound(
      ballot.selected_choice_id,
      'Сначала выберите победителя голосования',
    );
    const action = parseAction(assertFound(findAction(this.database, game.id, actionId)));
    insertAppliedAction(this.database, game.id, round.id, actionId, action.stage);
    persistRound(this.database, round, {
      activated_actions_json: JSON.stringify(plan.activatedActions ?? []),
      applied_at: new Date().toISOString(),
    });
    this.persistPlan(game, plan);
  }

  private openLegacyVoting(game: GameRow) {
    this.persistTransition(game, { current_round: this.nextRound(game), phase: 'VOTING' });
  }

  private closeLegacyVoting(game: GameRow) {
    assertCondition(
      game.phase === 'VOTING',
      409,
      'INVALID_PHASE',
      'Сейчас нет открытого голосования',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const optionIds = listOptions(this.database, round.id).map((option) => option.id);
    const leaders = optionLeaderIds(optionIds, listVoteCounts(this.database, round.id));
    persistRound(this.database, round, {
      selected_option_id: leaders.length === 1 ? leaders[0] : null,
      tied_option_ids_json: JSON.stringify(leaders.length > 1 ? leaders : []),
    });
    this.persistTransition(game, { phase: 'RESULT' });
  }

  private resolveLegacyTie(game: GameRow, optionId: string | undefined) {
    assertCondition(
      game.phase === 'RESULT',
      409,
      'INVALID_PHASE',
      'Выбрать победителя можно только при ничьей',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const leaders = parseIds(round.tied_option_ids_json);
    assertLeader(optionId, leaders);
    persistRound(this.database, round, {
      selected_option_id: optionId,
      tied_option_ids_json: '[]',
    });
    this.persistTransition(game, { phase: 'RESULT' });
  }

  private showLegacyEvent(game: GameRow) {
    assertCondition(
      game.phase === 'RESULT',
      409,
      'INVALID_PHASE',
      'Событие можно показать только после выбора победителя',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    const optionId = assertFound(
      round.selected_option_id,
      'Сначала выберите победителя голосования',
    );
    const option = parseOption(assertFound(findOption(this.database, round.id, optionId)));
    const plan = resolveLegacy(this.database, game, round, option);
    persistRound(this.database, round, {
      pending_plan_json: JSON.stringify(plan),
      shown_event_json: JSON.stringify(plan.event),
    });
    this.persistTransition(game, { phase: 'EVENT' });
  }

  private applyLegacyConsequences(game: GameRow) {
    const { plan, round } = this.pendingConsequences(game);
    persistRound(this.database, round, {
      activated_actions_json: '[]',
      applied_at: new Date().toISOString(),
    });
    this.persistPlan(game, plan);
  }

  private pendingConsequences(game: GameRow) {
    assertCondition(
      game.phase === 'EVENT',
      409,
      'INVALID_PHASE',
      'Сначала покажите событие, затем примените последствия',
    );
    const round = assertFound(findRound(this.database, game.id, game.current_round));
    return {
      plan: assertFound(parsePlan(round), 'Не нашли расчёт этого хода. Обновите пульт'),
      round,
    };
  }

  private persistPlan(game: GameRow, plan: NonNullable<ReturnType<typeof parsePlan>>) {
    const outcome = evaluateOutcome(
      plan.metrics,
      plan.stages,
      game.current_round + 1,
      parseRules(game),
    );
    this.persistTransition(game, {
      metrics_json: JSON.stringify(plan.metrics),
      outcome_reason: outcome.reason,
      phase: outcome.phase,
      properties_json: JSON.stringify(plan.properties),
      stages_json: JSON.stringify(plan.stages),
    });
  }

  private nextRound(game: GameRow) {
    assertCondition(
      game.phase === 'LOBBY' || game.phase === 'FEEDBACK',
      409,
      'INVALID_PHASE',
      'Сейчас нельзя открыть новое голосование. Сначала завершите текущий ход',
    );
    const next = game.phase === 'LOBBY' ? 0 : game.current_round + 1;
    const rules = parseRules(game);
    if (rules.roundMode !== 'CYCLIC') {
      assertCondition(next < rules.roundLimit, 409, 'NO_MORE_ROUNDS', 'Все раунды уже сыграны');
    }
    ensureRoundInstance(this.database, game, next, rules);
    return next;
  }

  private persistTransition(game: GameRow, patch: Parameters<typeof persistGameTransition>[2]) {
    const changed = persistGameTransition(this.database, game, patch);
    assertCondition(
      changed,
      409,
      'VERSION_CONFLICT',
      'Игра уже перешла дальше. Обновите страницу и попробуйте ещё раз',
    );
  }

  private assertAdmin(game: GameRow, token: string) {
    assertCondition(
      tokenMatches(token, game.admin_token_hash),
      401,
      'INVALID_ADMIN_TOKEN',
      'Пароль ведущего больше не подходит. Войдите заново',
    );
  }

  private matchingAdminCredential(game: GameRow, password: string) {
    const candidate = password.trim();
    if (tokenMatches(candidate, game.admin_token_hash)) return candidate;
    const upper = candidate.toUpperCase();
    assertCondition(
      tokenMatches(upper, game.admin_token_hash),
      401,
      'INVALID_ADMIN_PASSWORD',
      'Неверный пароль ведущего',
    );
    return upper;
  }

  private assertVersion(game: GameRow, expected: number) {
    if (game.transition_version === expected) return;
    throw new AppError(
      409,
      'VERSION_CONFLICT',
      'Игра уже перешла дальше. Обновите страницу и попробуйте ещё раз',
      buildGameState(this.database, game),
    );
  }
}

function ensureRoundInstance(
  database: GameDatabase,
  game: GameRow,
  roundIndex: number,
  rules: GameRules,
) {
  if (findRound(database, game.id, roundIndex)) return;
  assertCondition(rules.roundMode === 'CYCLIC', 409, 'NO_MORE_ROUNDS', 'Все раунды уже сыграны');
  const template = assertFound(findRound(database, game.id, roundIndex % rules.roundLimit));
  const decision = assertFound(findRoundDecision(database, template.id));
  insertRoundCopy(database, game.id, template, roundIndex + 1, decision.stageChoices);
}

function availableStageChoices(database: GameDatabase, game: GameRow, round: RoundRow) {
  const snapshot = engineSnapshot(database, game);
  const catalog = actionCatalog(database, game.id);
  const choices = findRoundDecision(database, round.id)?.stageChoices ?? [];
  return getAvailableStageChoices(catalog, choices, snapshot);
}

function buildAdminForecast(database: GameDatabase, game: GameRow): AdminForecast {
  const round = findRound(database, game.id, game.current_round);
  const ballot = round ? findCurrentBallot(database, round.id) : null;
  const ballotVisible = game.phase === 'VOTING' || game.phase === 'RESULT';
  if (!round || !ballot || !ballotVisible || game.decision_model !== 'STAGE_ACTION_V2') {
    return forecastEnvelope(game, null, null, { actionPotentials: [], stagePotentials: [] });
  }
  const snapshot = engineSnapshot(database, game);
  const catalog = actionCatalog(database, game.id);
  const data =
    ballot.kind === 'STAGE'
      ? stageForecast(database, game, round, snapshot, catalog, ballot.id)
      : actionForecast(database, game, round, snapshot, catalog, ballot.id);
  return forecastEnvelope(game, ballot.id, ballot.kind, data);
}

function forecastEnvelope(
  game: GameRow,
  ballotId: string | null,
  kind: AdminForecast['kind'],
  data: Pick<AdminForecast, 'actionPotentials' | 'stagePotentials'>,
): AdminForecast {
  return {
    ...data,
    ballotId,
    kind,
    revision: game.revision,
    transitionVersion: game.transition_version,
  };
}

function stageForecast(
  database: GameDatabase,
  game: GameRow,
  round: RoundRow,
  snapshot: EngineSnapshot,
  catalog: StageActionCatalog,
  ballotId: string,
): Pick<AdminForecast, 'actionPotentials' | 'stagePotentials'> {
  const mechanics = parseMechanics(game);
  const scenario = scenarioRound(database, round);
  const choices = listBallotChoiceIds(database, ballotId).map((id) =>
    findStageChoice(database, round, id as StageKey),
  );
  return {
    actionPotentials: [],
    stagePotentials: choices.map((choice) =>
      forecastStage(snapshot, scenario, choice, mechanics, catalog),
    ),
  };
}

function actionForecast(
  database: GameDatabase,
  game: GameRow,
  round: RoundRow,
  snapshot: EngineSnapshot,
  catalog: StageActionCatalog,
  ballotId: string,
): Pick<AdminForecast, 'actionPotentials' | 'stagePotentials'> {
  const mechanics = parseMechanics(game);
  const scenario = scenarioRound(database, round);
  const actions = listBallotChoiceIds(database, ballotId).map((id) =>
    parseAction(assertFound(findAction(database, game.id, id))),
  );
  return {
    actionPotentials: actions.map((action) =>
      forecastAction(snapshot, scenario, action, mechanics, catalog),
    ),
    stagePotentials: [],
  };
}

function findStageChoice(database: GameDatabase, round: RoundRow, stage: StageKey) {
  const choices = findRoundDecision(database, round.id)?.stageChoices ?? [];
  return assertFound(
    choices.find((choice) => choice.stage === stage),
    'Такого этапа в этом голосовании нет',
  );
}

function actionCatalog(database: GameDatabase, gameId: string): StageActionCatalog {
  return Object.fromEntries(
    listActions(database, gameId).map((row) => {
      const { id: _, ...action } = parseAction(row);
      return [row.action_id, action];
    }),
  );
}

function engineSnapshot(database: GameDatabase, game: GameRow): EngineSnapshot {
  const history = listAppliedActions(database, game.id).map((row) => ({
    actionId: row.action_id,
    roundNumber: row.round_number,
    stage: row.stage,
  }));
  return {
    appliedActions: history,
    metrics: JSON.parse(game.metrics_json) as MetricValues,
    properties: JSON.parse(game.properties_json) as ProcessProperty[],
    stages: JSON.parse(game.stages_json) as Record<StageKey, StageState>,
  };
}

function scenarioRound(database: GameDatabase, round: RoundRow): ScenarioRound {
  return {
    eventRules: parseEventRules(round),
    id: round.id,
    number: round.round_number,
    situation: round.situation,
    stageChoices: findRoundDecision(database, round.id)?.stageChoices ?? [],
    title: round.title,
  };
}

function resolveLegacy(
  database: GameDatabase,
  game: GameRow,
  round: RoundRow,
  option: EngineOption,
) {
  const snapshot = engineSnapshot(database, game);
  const stages = applyLegacyStageChanges(snapshot.stages, option.stageChanges);
  const projected = { ...snapshot, stages };
  const action = legacyAction(option, stages[option.stage]);
  const legacyRound = { ...scenarioRound(database, round), eventRules: legacyEventRules(round) };
  return resolveRound(projected, legacyRound, action, parseMechanics(game), {});
}

function legacyAction(option: EngineOption, current: StageState): EngineAction {
  const resulting =
    option.stageChanges.find(({ stage }) => stage === option.stage)?.state ?? current;
  return {
    ...option,
    availableInStates: ['AS_IS', 'AI_ENABLED', 'BROKEN'],
    repeatable: true,
    resultingStageState: resulting,
  };
}

function legacyEventRules(round: RoundRow): ScenarioRound['eventRules'] {
  return parseEventRules(round).map((rule) => {
    const legacy = rule as typeof rule & { optionIds?: string[] };
    return { ...rule, actionIds: rule.actionIds ?? legacy.optionIds };
  });
}

function applyLegacyStageChanges(stages: Record<StageKey, StageState>, changes: StageMutation[]) {
  const next = { ...stages };
  for (const change of changes) next[change.stage] = change.state;
  return next;
}

function persistDecisionRoundResult(database: GameDatabase, round: RoundRow, leaders: string[]) {
  persistRound(database, round, {
    selected_option_id: leaders.length === 1 ? (leaders[0] ?? null) : null,
    tied_option_ids_json: JSON.stringify(leaders.length > 1 ? leaders : []),
  });
}

function choiceLeaderIds(choiceIds: string[], counts: { choice_id: string; count: number }[]) {
  const byChoice = new Map(counts.map((item) => [item.choice_id, item.count]));
  const maximum = Math.max(0, ...choiceIds.map((id) => byChoice.get(id) ?? 0));
  return choiceIds.filter((id) => (byChoice.get(id) ?? 0) === maximum);
}

function optionLeaderIds(optionIds: string[], counts: { count: number; option_id: string }[]) {
  const normalized = counts.map(({ count, option_id }) => ({ choice_id: option_id, count }));
  return choiceLeaderIds(optionIds, normalized);
}

function assertLeader(choiceId: string | undefined, leaders: string[]) {
  assertCondition(
    choiceId && leaders.includes(choiceId),
    400,
    'NOT_A_LEADER',
    'Выберите один из вариантов с максимальным числом голосов',
  );
}

function parseRules(game: GameRow): GameRules {
  return JSON.parse(game.rules_json) as GameRules;
}

function parseMechanics(game: GameRow): GameMechanics {
  return JSON.parse(game.mechanics_json) as GameMechanics;
}

function parseIds(value: string) {
  return JSON.parse(value) as string[];
}
