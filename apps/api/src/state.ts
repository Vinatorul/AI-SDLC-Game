import {
  type ActionBallotChoice,
  type ActivatedActionView,
  type AdminCommandName,
  type AppliedActionView,
  type BallotChoice,
  type BallotTally,
  type BallotView,
  type BlockedActivationView,
  type GameEvent,
  type GameRules,
  type GameState,
  type MetricDefinitions,
  type MetricDelta,
  type MetricValues,
  metricKeys,
  type ProcessProperty,
  type RecoveryActionView,
  type RecoveryGuideView,
  type RoundOption,
  type RoundView,
  type StageKey,
  type StageProgress,
  type StageState,
  stageKeys,
  type VoteTally,
} from '@ai-sdlc/contracts';
import type {
  EngineAction,
  EngineEvent,
  EngineOption,
  GameMechanics,
  RecoveryGuide,
  ResolutionPlan,
  ScenarioMechanics,
} from '@ai-sdlc/game-engine';
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
  listRoundActivations,
  listVoteCounts,
  parseOption,
  parsePlan,
  type RoundRow,
} from './db/store';
import { metricImpact } from './metric-impact';

export function buildGameState(database: GameDatabase, game: GameRow): GameState {
  const round = currentRound(database, game);
  const ballot = round ? buildBallot(database, game, round) : null;
  const roundView = round ? buildRoundView(database, game, round, ballot) : null;
  const mechanics = JSON.parse(game.mechanics_json) as StoredScenarioMechanics;
  const stages = JSON.parse(game.stages_json) as Record<StageKey, StageState>;
  return {
    allowedCommands: allowedCommands(game, round, ballot),
    code: game.code,
    currentBallot: ballot,
    currentRound: roundView,
    decisionModel: game.decision_model,
    ...publicMetricConfig(mechanics),
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

type StoredScenarioMechanics = GameMechanics &
  Partial<Pick<ScenarioMechanics, 'metricDefinitions' | 'metricScaleDescription'>>;

function publicMetricConfig(mechanics: StoredScenarioMechanics) {
  return {
    metricBounds: mechanics.metricBounds,
    metricDefinitions: mechanics.metricDefinitions ?? legacyMetricDefinitions,
    metricScaleDescription: mechanics.metricScaleDescription ?? 'Чем выше балл, тем лучше',
  };
}

const legacyMetricDefinitions: MetricDefinitions = {
  controllability: {
    description: 'Насколько обещания команды совпадают с тем, что и когда получает пользователь.',
    label: 'Предсказуемость результата',
    maximumDescription:
      'Команда заранее понимает, что и когда получит пользователь, выполняет обещания, а риски замечает заранее.',
    maximumLabel: 'Риски видны заранее',
    minimumDescription:
      'Никто не знает, что и когда получится. Обещания не сходятся с фактом, каждый релиз — сюрприз.',
    minimumLabel: 'Каждый релиз — сюрприз',
  },
  deliverySpeed: {
    description:
      'Насколько быстро решение превращается в результат у пользователя: чем выше балл, тем короче TTM.',
    label: 'TTM',
    maximumDescription:
      'Нужное изменение доходит до пользователей почти сразу после решения, без очередей и долгого ожидания.',
    maximumLabel: 'Почти сразу',
    minimumDescription:
      'Изменения добираются до пользователей так долго, что успевают потерять смысл.',
    minimumLabel: 'Слишком долго',
  },
  quality: {
    description:
      'Работают ли изменения так, как ожидала команда, и не создают ли они проблем пользователям.',
    label: 'Качество и стабильность',
    maximumDescription:
      'Изменения работают как задумано, не ломают существующее, а технические проблемы почти не доходят до пользователей.',
    maximumLabel: 'Работает как задумано',
    minimumDescription:
      'Каждое изменение приносит новые баги. В проде постоянно случаются инциденты, пользователи сталкиваются с проблемами.',
    minimumLabel: 'Баги и инциденты',
  },
  teamCapacity: {
    description: 'Сколько ресурса остаётся на новое после поддержки, переделок и инцидентов.',
    label: 'Баланс Run / Change',
    maximumDescription:
      'Команда победила рутину поддержки: проблемы редки или решаются автоматически, почти весь ресурс уходит на новое.',
    maximumLabel: 'Ресурс на новое',
    minimumDescription:
      'Команда утонула в поддержке: на новое времени нет, а баги прилетают быстрее, чем их успевают закрывать.',
    minimumLabel: 'Run съел Change',
  },
};

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
  const plan = visiblePlan(game, round);
  const options = legacy ? legacyOptions(database, game, round) : ballotActionOptions(ballot);
  const selected = ballot?.kind === 'ACTION' ? ballot.selectedChoiceId : round.selected_option_id;
  const tied =
    ballot?.kind === 'ACTION' ? ballot.tiedChoiceIds : parseIds(round.tied_option_ids_json);
  return {
    activatedActions: activationViews(database, game.id, planActivations(plan)),
    blockedActivations: blockedActivationViews(database, game.id, planBlockedActivations(plan)),
    effectBreakdown: plan?.breakdown ?? null,
    effectContributions: plan?.effectContributions,
    event: visibleEvent(game, round),
    id: round.id,
    metricImpact: visibleMetricImpact(game, round),
    number: round.round_number,
    options,
    recovery: visibleRecovery(database, game, round),
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
  const activations = recordedActivations(database, game.id);
  return Object.fromEntries(
    stageKeys.map((stage) => [
      stage,
      {
        activeAiAction: activeAiAction(
          database,
          game.id,
          stage,
          stages[stage],
          history,
          activations,
        ),
        appliedActions: history.filter((item) => item.stage === stage),
        state: stages[stage],
      },
    ]),
  ) as Record<StageKey, StageProgress>;
}

type StoredActivation = {
  actionId: string;
  completedByActionId: string;
  stage: StageKey;
};

type TimedActivation = StoredActivation & { roundNumber: number };
type StoredBlockedActivation = StoredActivation & {
  reason: 'STAGE_BROKEN' | 'STAGE_REPAIRED';
};

function planActivations(plan: ResolutionPlan | null): StoredActivation[] {
  return (
    (plan as (ResolutionPlan & { activatedActions?: StoredActivation[] }) | null)
      ?.activatedActions ?? []
  );
}

function planBlockedActivations(plan: ResolutionPlan | null): StoredBlockedActivation[] {
  return (
    (plan as (ResolutionPlan & { blockedActivations?: StoredBlockedActivation[] }) | null)
      ?.blockedActivations ?? []
  );
}

function recordedActivations(database: GameDatabase, gameId: string): TimedActivation[] {
  return listRoundActivations(database, gameId).flatMap((row) =>
    (JSON.parse(row.activated_actions_json) as StoredActivation[]).map((item) => ({
      ...item,
      roundNumber: row.round_number,
    })),
  );
}

function activationViews(
  database: GameDatabase,
  gameId: string,
  activations: StoredActivation[],
): ActivatedActionView[] {
  return activations.map((item) => activationWithTitles(database, gameId, item));
}

function blockedActivationViews(
  database: GameDatabase,
  gameId: string,
  activations: StoredBlockedActivation[],
): BlockedActivationView[] {
  const applied = new Set(listAppliedActions(database, gameId).map(({ action_id }) => action_id));
  return activations.map((item) => {
    const view = activationWithTitles(database, gameId, item);
    const action = parseAction(requiredAction(database, gameId, item.actionId));
    const recovery = recoveryGuideView(database, gameId, action.recovery, applied);
    return recovery ? { ...view, recovery } : view;
  });
}

function recoveryGuideView(
  database: GameDatabase,
  gameId: string,
  guide: RecoveryGuide | undefined,
  applied: Set<string>,
): RecoveryGuideView | null {
  if (!guide) return null;
  const prerequisites = (guide.prerequisiteActionIds ?? []).filter((id) => !applied.has(id));
  return {
    hostHint: guide.hostHint,
    prerequisiteActions: recoveryActionViews(database, gameId, prerequisites),
    repairActions: recoveryActionViews(database, gameId, guide.repairActionIds ?? []),
  };
}

function recoveryActionViews(database: GameDatabase, gameId: string, ids: string[]) {
  return ids.map((actionId): RecoveryActionView => {
    const action = parseAction(requiredAction(database, gameId, actionId));
    return { actionId, stage: action.stage, title: action.title };
  });
}

function activationWithTitles<T extends StoredActivation>(
  database: GameDatabase,
  gameId: string,
  item: T,
) {
  const completedBy = parseAction(requiredAction(database, gameId, item.completedByActionId));
  const activated = parseAction(requiredAction(database, gameId, item.actionId));
  return { ...item, completedByTitle: completedBy.title, title: activated.title };
}

function activeAiAction(
  database: GameDatabase,
  gameId: string,
  stage: StageKey,
  state: StageState,
  history: AppliedActionView[],
  activations: TimedActivation[],
) {
  if (state !== 'AI_ENABLED') return null;
  const direct = latestDirectAiAction(database, gameId, stage, history);
  const automatic = latestAutomaticAiAction(stage, history, activations);
  if (!direct) return automatic?.action ?? null;
  if (!automatic || direct.roundNumber >= automatic.roundNumber) return direct.action;
  return automatic.action;
}

function latestDirectAiAction(
  database: GameDatabase,
  gameId: string,
  stage: StageKey,
  history: AppliedActionView[],
) {
  return history
    .filter((item) => item.stage === stage)
    .filter((item) => actionEnablesAi(parseAction(requiredAction(database, gameId, item.actionId))))
    .map((action) => ({ action, roundNumber: action.roundNumber }))
    .at(-1);
}

function latestAutomaticAiAction(
  stage: StageKey,
  history: AppliedActionView[],
  activations: TimedActivation[],
) {
  return activations
    .filter((item) => item.stage === stage)
    .flatMap((item) => {
      const action = [...history].reverse().find(({ actionId }) => actionId === item.actionId);
      return action ? [{ action, roundNumber: item.roundNumber }] : [];
    })
    .sort(
      (left, right) =>
        left.roundNumber - right.roundNumber || left.action.roundNumber - right.action.roundNumber,
    )
    .at(-1);
}

function actionEnablesAi(action: EngineAction) {
  if (action.resultingStageState === 'AI_ENABLED') return true;
  return Object.entries(action.stageTransitions ?? {}).some(
    ([from, to]) => from !== 'AI_ENABLED' && to === 'AI_ENABLED',
  );
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
  if (!action) throw new Error(`Не удалось найти решение ${actionId}`);
  return action;
}

function visibleEvent(game: GameRow, round: RoundRow): GameEvent | null {
  if (!['EVENT', 'FEEDBACK', 'WON', 'BROKEN'].includes(game.phase)) return null;
  if (!round.shown_event_json) return null;
  return publicEvent(JSON.parse(round.shown_event_json) as EngineEvent);
}

function visibleRecovery(
  database: GameDatabase,
  game: GameRow,
  round: RoundRow,
): RecoveryGuideView | null {
  if (!['EVENT', 'FEEDBACK', 'WON', 'BROKEN'].includes(game.phase)) return null;
  if (!round.shown_event_json) return null;
  const event = JSON.parse(round.shown_event_json) as EngineEvent;
  const applied = new Set(listAppliedActions(database, game.id).map(({ action_id }) => action_id));
  return recoveryGuideView(database, game.id, event.recovery, applied);
}

function publicEvent(event: EngineEvent): GameEvent {
  return {
    description: event.description,
    evidence: event.evidence,
    id: event.id,
    title: event.title,
  };
}

function visibleMetricImpact(game: GameRow, round: RoundRow) {
  if (!['EVENT', 'FEEDBACK', 'WON', 'BROKEN'].includes(game.phase)) return null;
  const plan = parsePlan(round);
  if (!plan) return null;
  const applied = plan.breakdown.applied ?? legacyPendingEffect(game, plan);
  return applied ? metricImpact(applied) : null;
}

function legacyPendingEffect(game: GameRow, plan: ResolutionPlan): MetricDelta | null {
  if (game.phase !== 'EVENT') return null;
  const current = JSON.parse(game.metrics_json) as MetricValues;
  return Object.fromEntries(
    metricKeys.map((key) => [key, plan.metrics[key] - current[key]]),
  ) as MetricDelta;
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
