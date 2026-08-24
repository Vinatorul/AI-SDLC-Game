import {
  type ActionBallotChoice,
  type AdminCommandName,
  type AppliedActionView,
  type BallotChoice,
  type BallotTally,
  type BallotView,
  type GameEvent,
  type GameRules,
  type GameState,
  type MetricValues,
  type ProcessProperty,
  type RoundOption,
  type RoundView,
  type StageKey,
  type StageProgress,
  type StageState,
  stageKeys,
  type VoteTally,
} from '@ai-sdlc/contracts';
import type { EngineAction, EngineEvent, EngineOption, ResolutionPlan } from '@ai-sdlc/game-engine';
import type { GameDatabase } from './db/database';
import {
  type BallotRow,
  findAction,
  findBallotByKind,
  findCurrentBallot,
  findRoundDecision,
  listAppliedActions,
  listBallotChoiceIds,
  listBallotVoteCounts,
  parseAction,
} from './db/decision-store';
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
  const round = currentRound(database, game);
  const ballot = round ? buildBallot(database, game, round) : null;
  const roundView = round ? buildRoundView(database, game, round, ballot) : null;
  const stages = JSON.parse(game.stages_json) as Record<StageKey, StageState>;
  return {
    allowedCommands: allowedCommands(game, round, ballot),
    code: game.code,
    currentBallot: ballot,
    currentRound: roundView,
    decisionModel: game.decision_model,
    metrics: JSON.parse(game.metrics_json) as MetricValues,
    myVoteChoiceId: null,
    myVoteOptionId: null,
    outcomeReason: game.outcome_reason,
    phase: game.phase,
    playerCount: countPlayers(database, game.id),
    properties: JSON.parse(game.properties_json) as ProcessProperty[],
    revision: game.revision,
    roundIndex: game.current_round,
    rules: JSON.parse(game.rules_json) as GameRules,
    stageProgress: buildStageProgress(database, game, stages),
    stages,
    transitionVersion: game.transition_version,
    voteCount: ballot?.voteTallies.reduce((sum, item) => sum + item.count, 0) ?? 0,
  };
}

function currentRound(database: GameDatabase, game: GameRow) {
  if (game.phase === 'LOBBY') return null;
  return findRound(database, game.id, game.current_round) ?? null;
}

function buildRoundView(
  database: GameDatabase,
  game: GameRow,
  round: RoundRow,
  ballot: BallotView | null,
): RoundView {
  const legacy = game.decision_model === 'SINGLE_OPTION_V1';
  const options = legacy ? legacyOptions(database, game, round) : ballotActionOptions(ballot);
  const selected = ballot?.kind === 'ACTION' ? ballot.selectedChoiceId : round.selected_option_id;
  const tied =
    ballot?.kind === 'ACTION' ? ballot.tiedChoiceIds : parseIds(round.tied_option_ids_json);
  return {
    effectBreakdown: visiblePlan(game, round)?.breakdown ?? null,
    event: visibleEvent(game, round),
    id: round.id,
    number: round.round_number,
    options,
    selectedOptionId: selected,
    situation: round.situation,
    tiedOptionIds: tied,
    title: round.title,
    voteTallies: optionTallies(ballot, options),
  };
}

function buildBallot(database: GameDatabase, game: GameRow, round: RoundRow): BallotView | null {
  if (game.decision_model === 'SINGLE_OPTION_V1') return legacyBallot(database, game, round);
  const ballot = findCurrentBallot(database, round.id);
  if (!ballot) return null;
  const choices = decisionChoices(database, game, round, ballot);
  return ballotView(database, round, ballot, choices);
}

function legacyBallot(database: GameDatabase, game: GameRow, round: RoundRow): BallotView {
  const choices = legacyOptions(database, game, round).map((option) => ({
    ...option,
    kind: 'LEGACY_OPTION' as const,
  }));
  const tallies = legacyTallies(
    database,
    round,
    choices.map(({ id }) => id),
  );
  return {
    choices,
    id: round.id,
    kind: 'LEGACY_OPTION',
    selectedChoiceId: round.selected_option_id,
    stage: null,
    tiedChoiceIds: parseIds(round.tied_option_ids_json),
    voteTallies: tallies.map(({ optionId, ...tally }) => ({ ...tally, choiceId: optionId })),
  };
}

function decisionChoices(
  database: GameDatabase,
  game: GameRow,
  round: RoundRow,
  ballot: BallotRow,
): BallotChoice[] {
  const choiceIds = listBallotChoiceIds(database, ballot.id);
  if (ballot.kind === 'STAGE') return stageChoices(database, round, choiceIds);
  return choiceIds.map((id) => actionChoice(database, game, id));
}

function stageChoices(
  database: GameDatabase,
  round: RoundRow,
  choiceIds: string[],
): BallotChoice[] {
  const configured = findRoundDecision(database, round.id)?.stageChoices ?? [];
  const byStage = new Map(configured.map((choice) => [choice.stage, choice]));
  return choiceIds.map((id) => {
    const choice = byStage.get(id as StageKey);
    if (!choice) throw new Error(`Неизвестный этап ${id}`);
    return {
      description: choice.description,
      id: choice.stage,
      kind: 'STAGE',
      stage: choice.stage,
      title: choice.title,
    };
  });
}

function actionChoice(database: GameDatabase, game: GameRow, actionId: string): BallotChoice {
  const action = parseAction(requiredAction(database, game.id, actionId));
  const option = publicOption(action, game.phase !== 'VOTING');
  return { ...option, kind: 'ACTION', repeatable: action.repeatable };
}

function ballotView(
  database: GameDatabase,
  round: RoundRow,
  ballot: BallotRow,
  choices: BallotChoice[],
): BallotView {
  return {
    choices,
    id: ballot.id,
    kind: ballot.kind,
    selectedChoiceId: ballot.selected_choice_id,
    stage: ballot.kind === 'ACTION' ? selectedStage(database, round.id) : null,
    tiedChoiceIds: parseIds(ballot.tied_choice_ids_json),
    voteTallies: decisionTallies(
      database,
      ballot.id,
      choices.map(({ id }) => id),
    ),
  };
}

function selectedStage(database: GameDatabase, roundId: string) {
  const selected = findBallotByKind(database, roundId, 'STAGE')?.selected_choice_id;
  return selected ? (selected as StageKey) : null;
}

function legacyOptions(database: GameDatabase, game: GameRow, round: RoundRow) {
  const showFeedback = !['LOBBY', 'VOTING'].includes(game.phase);
  return listOptions(database, round.id)
    .map(parseOption)
    .map((item) => publicOption(item, showFeedback));
}

function publicOption(option: EngineAction | EngineOption, showFeedback: boolean): RoundOption {
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

function ballotActionOptions(ballot: BallotView | null): RoundOption[] {
  if (ballot?.kind !== 'ACTION') return [];
  return (ballot.choices as ActionBallotChoice[]).map(
    ({ kind: _, repeatable: __, ...option }) => option,
  );
}

function optionTallies(ballot: BallotView | null, options: RoundOption[]): VoteTally[] {
  if (ballot?.kind !== 'ACTION') return [];
  const byId = new Map(ballot.voteTallies.map((item) => [item.choiceId, item]));
  return options.map(({ id }) => {
    const tally = byId.get(id) ?? { choiceId: id, count: 0, share: 0 };
    return { count: tally.count, optionId: id, share: tally.share };
  });
}

function legacyTallies(database: GameDatabase, round: RoundRow, optionIds: string[]): VoteTally[] {
  const counts = new Map(
    listVoteCounts(database, round.id).map((row) => [row.option_id, row.count]),
  );
  return createTallies(optionIds, counts).map(({ choiceId, ...item }) => ({
    ...item,
    optionId: choiceId,
  }));
}

function decisionTallies(database: GameDatabase, ballotId: string, choiceIds: string[]) {
  const rows = listBallotVoteCounts(database, ballotId);
  return createTallies(choiceIds, new Map(rows.map((row) => [row.choice_id, row.count])));
}

function createTallies(choiceIds: string[], counts: Map<string, number>): BallotTally[] {
  const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return choiceIds.map((choiceId) => {
    const count = counts.get(choiceId) ?? 0;
    return { choiceId, count, share: total === 0 ? 0 : count / total };
  });
}

function buildStageProgress(
  database: GameDatabase,
  game: GameRow,
  stages: Record<StageKey, StageState>,
): Record<StageKey, StageProgress> {
  const history = listAppliedActions(database, game.id).map((row) => appliedAction(database, row));
  return Object.fromEntries(
    stageKeys.map((stage) => [
      stage,
      { appliedActions: history.filter((item) => item.stage === stage), state: stages[stage] },
    ]),
  ) as Record<StageKey, StageProgress>;
}

function appliedAction(
  database: GameDatabase,
  row: ReturnType<typeof listAppliedActions>[number],
): AppliedActionView {
  const action = parseAction(requiredAction(database, row.game_id, row.action_id));
  return {
    actionId: row.action_id,
    roundNumber: row.round_number,
    stage: row.stage,
    title: action.title,
  };
}

function requiredAction(database: GameDatabase, gameId: string, actionId: string) {
  const action = findAction(database, gameId, actionId);
  if (!action) throw new Error(`Неизвестное действие ${actionId}`);
  return action;
}

function visibleEvent(game: GameRow, round: RoundRow): GameEvent | null {
  if (!['EVENT', 'FEEDBACK', 'WON', 'BROKEN'].includes(game.phase)) return null;
  if (!round.shown_event_json) return null;
  return publicEvent(JSON.parse(round.shown_event_json) as EngineEvent);
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

function allowedCommands(
  game: GameRow,
  round: RoundRow | null,
  ballot: BallotView | null,
): AdminCommandName[] {
  if (game.phase === 'LOBBY' || game.phase === 'FEEDBACK') return ['OPEN_VOTING'];
  if (game.phase === 'VOTING') return ['CLOSE_VOTING'];
  if (game.phase === 'EVENT') return ['APPLY_CONSEQUENCES'];
  if (game.phase !== 'RESULT' || !round) return [];
  if (!ballot?.selectedChoiceId) return ['RESOLVE_TIE'];
  if (ballot.kind === 'STAGE') return ['OPEN_NEXT_BALLOT'];
  return ['SHOW_EVENT'];
}

function parseIds(value: string) {
  return JSON.parse(value) as string[];
}
