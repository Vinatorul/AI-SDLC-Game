import type {
  AdminCommandName,
  GameEvent,
  GameRules,
  GameState,
  MetricValues,
  ProcessProperty,
  RoundOption,
  RoundView,
  StageKey,
  StageState,
  VoteTally,
} from '@ai-sdlc/contracts';
import type { EngineEvent, EngineOption, ResolutionPlan } from '@ai-sdlc/game-engine';
import type { GameDatabase } from './db/database';
import {
  countPlayers,
  findRound,
  type GameRow,
  listOptions,
  listVoteCounts,
  parseOption,
  parsePlan,
  type RoundRow,
} from './db/store';

export function buildGameState(database: GameDatabase, game: GameRow): GameState {
  const round =
    game.phase === 'LOBBY' ? null : (findRound(database, game.id, game.current_round) ?? null);
  const roundView = round ? buildRoundView(database, game, round) : null;
  return {
    allowedCommands: allowedCommands(game, round),
    code: game.code,
    currentRound: roundView,
    metrics: JSON.parse(game.metrics_json) as MetricValues,
    myVoteOptionId: null,
    outcomeReason: game.outcome_reason,
    phase: game.phase,
    playerCount: countPlayers(database, game.id),
    properties: JSON.parse(game.properties_json) as ProcessProperty[],
    revision: game.revision,
    roundIndex: game.current_round,
    rules: JSON.parse(game.rules_json) as GameRules,
    stages: JSON.parse(game.stages_json) as Record<StageKey, StageState>,
    transitionVersion: game.transition_version,
    voteCount: roundView?.voteTallies.reduce((sum, item) => sum + item.count, 0) ?? 0,
  };
}

function buildRoundView(database: GameDatabase, game: GameRow, round: RoundRow): RoundView {
  const showFeedback = !['LOBBY', 'VOTING'].includes(game.phase);
  const options = listOptions(database, round.id)
    .map(parseOption)
    .map((option) => publicOption(option, showFeedback));
  const tallies = createTallies(
    database,
    round,
    options.map((option) => option.id),
  );
  const plan = visiblePlan(game, round);
  return {
    effectBreakdown: plan?.breakdown ?? null,
    event: visibleEvent(game, round),
    id: round.id,
    number: round.round_number,
    options,
    selectedOptionId: round.selected_option_id,
    situation: round.situation,
    tiedOptionIds: JSON.parse(round.tied_option_ids_json) as string[],
    title: round.title,
    voteTallies: tallies,
  };
}

function publicOption(option: EngineOption, showFeedback: boolean): RoundOption {
  return {
    description: option.description,
    evidence: option.evidence,
    id: option.id,
    key: option.key,
    shortFeedback: showFeedback ? option.shortFeedback : null,
    stage: option.stage,
    title: option.title,
  };
}

function createTallies(database: GameDatabase, round: RoundRow, optionIds: string[]): VoteTally[] {
  const counts = new Map(
    listVoteCounts(database, round.id).map((row) => [row.option_id, row.count]),
  );
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return optionIds.map((optionId) => {
    const count = counts.get(optionId) ?? 0;
    return { count, optionId, share: total === 0 ? 0 : count / total };
  });
}

function visibleEvent(game: GameRow, round: RoundRow): GameEvent | null {
  if (!['EVENT', 'FEEDBACK', 'WON', 'BROKEN'].includes(game.phase)) return null;
  if (!round.shown_event_json) return null;
  const event = JSON.parse(round.shown_event_json) as EngineEvent;
  return publicEvent(event);
}

function publicEvent(event: EngineEvent): GameEvent {
  return {
    description: event.description,
    evidence: event.evidence,
    id: event.id,
    title: event.title,
  };
}

function visiblePlan(game: GameRow, round: RoundRow): ResolutionPlan | null {
  if (!['FEEDBACK', 'WON', 'BROKEN'].includes(game.phase)) return null;
  return parsePlan(round);
}

function allowedCommands(game: GameRow, round: RoundRow | null): AdminCommandName[] {
  if (game.phase === 'LOBBY' || game.phase === 'FEEDBACK') return ['OPEN_VOTING'];
  if (game.phase === 'VOTING') return ['CLOSE_VOTING'];
  if (game.phase === 'EVENT') return ['APPLY_CONSEQUENCES'];
  if (game.phase !== 'RESULT' || !round) return [];
  return round.selected_option_id ? ['SHOW_EVENT'] : ['RESOLVE_TIE'];
}
