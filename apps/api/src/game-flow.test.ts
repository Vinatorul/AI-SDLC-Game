import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  type AdminCommandName,
  type CreateGameResponse,
  type GameState,
  type JoinGameResponse,
  type StageKey,
  stageKeys,
  type VoteRequest,
} from '@ai-sdlc/contracts';
import {
  createInitialStages,
  defaultScenario,
  type EngineOption,
  type Scenario,
} from '@ai-sdlc/game-engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { hashToken } from './auth';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

it('заменяет голос за этап и запрещает голосовать после закрытия', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = await command(app, game, 'OPEN_VOTING', 0);
  const ballot = requiredBallot(state);
  expect(ballot.choices.map(({ id }) => id)).toEqual(stageKeys);
  const [first, second] = ballot.choices;
  if (!first || !second) throw new Error('Нет этапов');
  expect(first).not.toHaveProperty('actionIds');
  await vote(app, game.state.code, player.playerToken, { ballotId: ballot.id, choiceId: first.id });
  await vote(app, game.state.code, player.playerToken, {
    ballotId: ballot.id,
    choiceId: second.id,
  });
  state = await command(app, game, 'CLOSE_VOTING', 1);
  expect(tally(state, first.id)).toBe(0);
  expect(tally(state, second.id)).toBe(1);
  const response = await vote(app, game.state.code, player.playerToken, {
    ballotId: ballot.id,
    choiceId: first.id,
  });
  expect(response.statusCode).toBe(409);
});

it('отклоняет устаревшую версию админской команды', async () => {
  const app = await testApp();
  const game = await createGame(app);
  await command(app, game, 'OPEN_VOTING', 0);
  const response = await rawCommand(app, game, 'CLOSE_VOTING', 0);
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('VERSION_CONFLICT');
});

it('сохраняет порядок решений из сценария, если перемешивание выключено', async () => {
  const scenario = structuredClone(defaultScenario);
  scenario.rules.shuffleActionChoices = false;
  const app = await testApp(':memory:', scenario);
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  const opened = await openActionBallot(app, game, player, 'technicalDiscovery', 0);
  const expected = scenario.rounds[0]?.stageChoices.find(
    ({ stage }) => stage === 'technicalDiscovery',
  )?.actionIds;

  expect(requiredBallot(opened.state).choices.map(({ id }) => id)).toEqual(expected);
});

it('не открывает раунд, если осталось меньше двух доступных этапов', async () => {
  const app = await testApp(':memory:', scenarioWithOneStage());
  const game = await createGame(app);
  const response = await rawCommand(app, game, 'OPEN_VOTING', 0);
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('NOT_ENOUGH_STAGES');
});

it('отклоняет голос из предыдущего бюллетеня', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  const opened = await openActionBallot(app, game, player, 'technicalDiscovery', 0);
  const stale = opened.stageBallot;
  const response = await vote(app, game.state.code, player.playerToken, {
    ballotId: stale.id,
    choiceId: stale.choices[0]?.id ?? '',
  });
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('STALE_BALLOT');
});

it('разрешает ничьи отдельно для этапа и действия', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const firstPlayer = await joinGame(app, game.state.code, 'Ира');
  const secondPlayer = await joinGame(app, game.state.code, 'Олег');
  let state = await command(app, game, 'OPEN_VOTING', 0);
  const stage = requiredBallot(state);
  const technical = stage.choices.find(({ id }) => id === 'technicalDiscovery');
  const coding = stage.choices.find(({ id }) => id === 'coding');
  await voteFor(app, game, firstPlayer, stage.id, technical?.id);
  await voteFor(app, game, secondPlayer, stage.id, coding?.id);
  state = await command(app, game, 'CLOSE_VOTING', 1);
  expect(requiredBallot(state).tiedChoiceIds).toHaveLength(2);
  state = await command(app, game, 'RESOLVE_TIE', 2, technical?.id);
  state = await command(app, game, 'OPEN_NEXT_BALLOT', 3);
  const action = requiredBallot(state);
  await voteFor(app, game, firstPlayer, action.id, action.choices[0]?.id);
  await voteFor(app, game, secondPlayer, action.id, action.choices[1]?.id);
  state = await command(app, game, 'CLOSE_VOTING', 4);
  expect(requiredBallot(state).tiedChoiceIds).toEqual([
    action.choices[0]?.id,
    action.choices[1]?.id,
  ]);
  const invalid = await rawCommand(app, game, 'RESOLVE_TIE', 5, action.choices[2]?.id);
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json().code).toBe('NOT_A_LEADER');
});

it('не раскрывает эффекты действия и применяет последствия один раз', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let { state } = await openActionBallot(app, game, player, 'technicalDiscovery', 0);
  const action = requiredBallot(state).choices.find(
    ({ id }) => id === 'technicalDiscovery.code-research',
  );
  if (!action) throw new Error('Нет решения с числовым эффектом');
  expect(action).not.toHaveProperty('effect');
  expect(action).not.toHaveProperty('addProperties');
  await voteFor(app, game, player, requiredBallot(state).id, action?.id);
  state = await command(app, game, 'CLOSE_VOTING', 3);
  const duplicate = await rawCommand(app, game, 'OPEN_NEXT_BALLOT', 4);
  expect(duplicate.statusCode).toBe(409);
  expect(state.currentRound?.metricImpact).toBeNull();
  state = await command(app, game, 'SHOW_EVENT', 4);
  expect(state.currentRound?.event).not.toHaveProperty('effect');
  expect(state.currentRound?.effectBreakdown).toBeNull();
  expect(state.currentRound?.effectContributions).toBeUndefined();
  expect(state.currentRound?.metricImpact).toBe('IMPROVED');
  state = await command(app, game, 'APPLY_CONSEQUENCES', 5);
  const response = await rawCommand(app, game, 'APPLY_CONSEQUENCES', 6);
  expect(state.phase).toBe('FEEDBACK');
  expect(state.currentRound?.metricImpact).toBe('IMPROVED');
  expect(state.currentRound?.effectContributions?.length).toBeGreaterThan(0);
  expect(response.statusCode).toBe(409);
});

it('восстанавливает личный голос только по токену игрока', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  const state = await command(app, game, 'OPEN_VOTING', 0);
  const ballot = requiredBallot(state);
  const choiceId = ballot.choices[0]?.id ?? '';
  await voteFor(app, game, player, ballot.id, choiceId);
  const personal = await getState(app, game.state.code, player.playerToken);
  const publicState = await getState(app, game.state.code);
  expect(personal.myVoteChoiceId).toBe(choiceId);
  expect(publicState.myVoteChoiceId).toBeNull();
});

it('позволяет вернуться к этапу, но скрывает уже применённое неповторяемое действие', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  await playRound(app, game, player, 'technicalDiscovery', 'technicalDiscovery.code-research', 0);
  const opened = await openActionBallot(app, game, player, 'technicalDiscovery', 6);
  const actionIds = requiredBallot(opened.state).choices.map(({ id }) => id);
  expect(actionIds).not.toContain('technicalDiscovery.code-research');
  expect(actionIds).toContain('technicalDiscovery.sync-docs-and-contract');
  const state = await finishAction(
    app,
    game,
    player,
    'technicalDiscovery.sync-docs-and-contract',
    9,
    opened.state,
  );
  expect(
    state.stageProgress.technicalDiscovery.appliedActions.map(({ actionId }) => actionId),
  ).toEqual(['technicalDiscovery.code-research', 'technicalDiscovery.sync-docs-and-contract']);
  expect(state.stageProgress.technicalDiscovery.activeAiAction?.actionId).toBe(
    'technicalDiscovery.sync-docs-and-contract',
  );
});

it('чинит сломанный этап следующим решением и сохраняет историю', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = await playRound(app, game, player, 'coding', 'coding.guided-implementation', 0);
  expect(state.stageProgress.review.state).toBe('AS_IS');
  state = await playRound(app, game, player, 'coding', 'coding.guided-implementation', 6);
  expect(state.stageProgress.review.state).toBe('AS_IS');
  state = await playRound(app, game, player, 'coding', 'coding.guided-implementation', 12);
  expect(state.stageProgress.review.state).toBe('BROKEN');
  state = await playRound(app, game, player, 'review', 'review.context-and-human-risk', 18);
  expect(state.stageProgress.review.state).toBe('AI_ENABLED');
  expect(state.stageProgress.review.appliedActions[0]?.actionId).toBe(
    'review.context-and-human-risk',
  );
});

it('активирует установленный MCP после добавления недостающей основы', async () => {
  const app = await testApp();
  const game = await createGame(app);
  expect(game.state.decisionModel).toBe('STAGE_ACTION_V2');
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = await playRound(
    app,
    game,
    player,
    'businessRequest',
    'businessRequest.feedback-mcp',
    0,
  );
  expect(state.stages.businessRequest).toBe('AS_IS');
  state = await playRound(
    app,
    game,
    player,
    'businessRequest',
    'businessRequest.outcome-metrics',
    6,
  );
  expectBusinessActivation(state);
});

it('включает установленный скилл сразу после ремонта его этапа', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = await playRound(
    app,
    game,
    player,
    'productDiscovery',
    'productDiscovery.knowledge-skill',
    0,
  );
  expect(state.stages.productDiscovery).toBe('BROKEN');
  state = await playRound(
    app,
    game,
    player,
    'productDiscovery',
    'productDiscovery.knowledge-base',
    6,
  );
  expect(state.stages.productDiscovery).toBe('AI_ENABLED');
  expect(state.currentRound?.activatedActions).toContainEqual(
    expect.objectContaining({ actionId: 'productDiscovery.knowledge-skill' }),
  );
});

it('показывает последнее из одновременно активированных AI-решений этапа', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  const actions: [StageKey, string][] = [
    ['deployment', 'deployment.mcp-tooling'],
    ['deployment', 'deployment.autonomous-after-tests'],
    ['deployment', 'deployment.rollback-drill'],
    ['support', 'support.telemetry-baseline'],
    ['testing', 'testing.behavior-checks'],
  ];
  let state = game.state;
  for (const [index, [stage, actionId]] of actions.entries()) {
    state = await playRound(app, game, player, stage, actionId, index * 6);
  }
  expect(state.currentRound?.activatedActions).toHaveLength(2);
  expect(state.stageProgress.deployment.activeAiAction?.actionId).toBe(
    'deployment.autonomous-after-tests',
  );
});

it('показывает ведущему настроенный план после открытия события', async () => {
  const app = await testApp(':memory:', scenarioWithBlockedActivation());
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let { state } = await openActionBallot(app, game, player, 'businessRequest', 0);
  const ballot = requiredBallot(state);
  await voteFor(app, game, player, ballot.id, 'businessRequest.feedback-mcp');
  state = await command(app, game, 'CLOSE_VOTING', 3);
  expect(state.currentRound?.recovery).toBeNull();
  state = await command(app, game, 'SHOW_EVENT', 4);
  expect(state.phase).toBe('EVENT');
  expect(state.currentRound?.recovery?.hostHint).toBe(recoveryHostHint);
  expect(state.currentRound?.recovery?.prerequisiteActions).toEqual([
    actionView('businessRequest.outcome-metrics'),
  ]);
  expect(state.currentRound?.recovery?.repairActions).toEqual([
    actionView('businessRequest.production-signals'),
  ]);
});

it('объясняет, почему поздняя активация не починила сломанный этап', async () => {
  const app = await testApp(':memory:', scenarioWithBlockedActivation());
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = await playBusinessAction(app, game, player, 'businessRequest.feedback-mcp', 0);
  expect(state.stages.businessRequest).toBe('BROKEN');
  state = await playBusinessAction(app, game, player, 'businessRequest.outcome-metrics', 6);
  expect(state.stages.businessRequest).toBe('BROKEN');
  expect(state.currentRound?.activatedActions).toEqual([]);
  expect(state.currentRound?.blockedActivations).toEqual([
    expect.objectContaining({
      actionId: 'businessRequest.feedback-mcp',
      completedByActionId: 'businessRequest.outcome-metrics',
      completedByTitle: defaultScenario.stageActions['businessRequest.outcome-metrics']?.title,
      reason: 'STAGE_BROKEN',
      recovery: {
        hostHint: recoveryHostHint,
        prerequisiteActions: [],
        repairActions: [actionView('businessRequest.production-signals')],
      },
      title: defaultScenario.stageActions['businessRequest.feedback-mcp']?.title,
    }),
  ]);
});

it('не скрывает повторяемое решение для ремонта, если его уже выбирали', async () => {
  const app = await testApp(':memory:', scenarioWithBlockedActivation());
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  await playBusinessAction(app, game, player, 'businessRequest.production-signals', 0);
  await playBusinessAction(app, game, player, 'businessRequest.feedback-mcp', 6);
  const state = await playBusinessAction(app, game, player, 'businessRequest.outcome-metrics', 12);
  expect(state.currentRound?.blockedActivations?.[0]?.recovery?.repairActions).toEqual([
    actionView('businessRequest.production-signals'),
  ]);
});

it('продолжает игру, пока все восемь этапов не станут зелёными', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = game.state;
  for (const [index, [stage, actionId]] of winningActions.entries()) {
    state = await playRound(app, game, player, stage, actionId, index * 6);
    expect(state.phase).toBe(index === winningActions.length - 1 ? 'WON' : 'FEEDBACK');
  }
  expect(state.currentRound?.number).toBe(8);
  expect(stageKeys.every((stage) => state.stages[stage] === 'AI_ENABLED')).toBe(true);
});

it('разрешает CORS preflight для смены голоса', async () => {
  const app = await testApp();
  const response = await app.inject({
    headers: {
      'access-control-request-headers': 'authorization,content-type',
      'access-control-request-method': 'PUT',
      origin: 'http://127.0.0.1:5173',
    },
    method: 'OPTIONS',
    url: '/api/games/ABC234/vote',
  });
  expect(response.statusCode).toBe(204);
  expect(response.headers['access-control-allow-methods']).toContain('PUT');
});

describe('восстановление SQLite', () => {
  it('возвращает открытый бюллетень и голос после перезапуска', async () => {
    const { databasePath, directory } = temporaryDatabase('ai-sdlc-ballot-');
    const first = await testApp(databasePath);
    const game = await createGame(first);
    const player = await joinGame(first, game.state.code, 'Ира');
    const opened = await openActionBallot(first, game, player, 'testing', 0);
    const ballot = requiredBallot(opened.state);
    const choiceIds = ballot.choices.map(({ id }) => id);
    const choiceId = ballot.choices[0]?.id ?? '';
    await voteFor(first, game, player, ballot.id, choiceId);
    await closeTrackedApp(first);
    const second = await testApp(databasePath);
    const state = await getState(second, game.state.code, player.playerToken);
    expect(state.currentBallot?.id).toBe(ballot.id);
    expect(state.currentBallot?.choices.map(({ id }) => id)).toEqual(choiceIds);
    expect(state.myVoteChoiceId).toBe(choiceId);
    await closeTrackedApp(second);
    rmSync(directory, { force: true, recursive: true });
  });

  it('возвращает историю решений после перезапуска', async () => {
    const { databasePath, directory } = temporaryDatabase('ai-sdlc-history-');
    const first = await testApp(databasePath);
    const game = await createGame(first);
    const player = await joinGame(first, game.state.code, 'Ира');
    await playRound(first, game, player, 'businessRequest', 'businessRequest.feedback-mcp', 0);
    await playRound(first, game, player, 'businessRequest', 'businessRequest.outcome-metrics', 6);
    await closeTrackedApp(first);
    const second = await testApp(databasePath);
    const state = await getState(second, game.state.code);
    expect(state.stageProgress.businessRequest.activeAiAction?.actionId).toBe(
      'businessRequest.feedback-mcp',
    );
    expect(state.currentRound?.activatedActions?.[0]?.completedByActionId).toBe(
      'businessRequest.outcome-metrics',
    );
    await closeTrackedApp(second);
    rmSync(directory, { force: true, recursive: true });
  });

  it('создаёт отдельный следующий ход при любом id шаблона и восстанавливает его', async () => {
    const { databasePath, directory } = temporaryDatabase('ai-sdlc-cycle-');
    const first = await testApp(databasePath, scenarioWithTemplateId('round-2'));
    const game = await createGame(first);
    const player = await joinGame(first, game.state.code, 'Ира');
    const firstState = await playRound(
      first,
      game,
      player,
      'businessRequest',
      'businessRequest.expected-outcome',
      0,
    );
    const secondState = await command(first, game, 'OPEN_VOTING', 6);
    expect(secondState.currentRound?.number).toBe(2);
    expect(secondState.currentRound?.title).toBe(firstState.currentRound?.title);
    expect(secondState.currentRound?.id).not.toBe(firstState.currentRound?.id);
    const ballotId = requiredBallot(secondState).id;
    await closeTrackedApp(first);
    const second = await testApp(databasePath);
    const restored = await getState(second, game.state.code);
    expect(restored.currentRound?.id).toBe(secondState.currentRound?.id);
    expect(restored.currentBallot?.id).toBe(ballotId);
    await closeTrackedApp(second);
    rmSync(directory, { force: true, recursive: true });
  });
});

it('после перезапуска использует сохранённые правила игры', async () => {
  const { databasePath, directory } = temporaryDatabase('ai-sdlc-rules-');
  const first = await testApp(databasePath, noRoundsScenario());
  const game = await createGame(first);
  await closeTrackedApp(first);
  const second = await testApp(databasePath);
  const response = await rawCommand(second, game, 'OPEN_VOTING', 0);
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('NO_MORE_ROUNDS');
  await closeTrackedApp(second);
  rmSync(directory, { force: true, recursive: true });
});

it('сохраняет порядок старой комнаты с несколькими шаблонами', async () => {
  const { databasePath, directory } = temporaryDatabase('ai-sdlc-old-cycle-');
  const oldApp = await testApp(databasePath, scenarioWithTwoTemplates());
  const game = await createGame(oldApp);
  const player = await joinGame(oldApp, game.state.code, 'Ира');
  const first = await playRound(
    oldApp,
    game,
    player,
    'businessRequest',
    'businessRequest.expected-outcome',
    0,
  );
  await closeTrackedApp(oldApp);
  const currentApp = await testApp(databasePath);
  const second = await playRound(
    currentApp,
    game,
    player,
    'productDiscovery',
    'productDiscovery.requirement-draft',
    6,
  );
  const third = await command(currentApp, game, 'OPEN_VOTING', 12);
  expectOldCycleOrder(first, second, third);
  expect(third.currentRound?.number).toBe(3);
  await closeTrackedApp(currentApp);
  rmSync(directory, { force: true, recursive: true });
});

it('после перезапуска использует сохранённую механику и шкалу', async () => {
  const { databasePath, directory } = temporaryDatabase('ai-sdlc-mechanics-');
  const first = await testApp(databasePath, scenarioWithContextQuality(2));
  const game = await createGame(first);
  expect(game.state.metricBounds).toEqual({ maximum: 10, minimum: -10 });
  expect(game.state.metricDefinitions.teamCapacity.label).toBe('Баланс Run / Change');
  await closeTrackedApp(first);
  const second = await testApp(databasePath);
  const player = await joinGame(second, game.state.code, 'Ира');
  let state = await playRound(
    second,
    game,
    player,
    'technicalDiscovery',
    'technicalDiscovery.code-research',
    0,
  );
  expect(state.metrics.quality).toBe(3);
  expect(state.metricDefinitions.teamCapacity.label).toBe('Баланс Run / Change');
  state = await playRound(second, game, player, 'coding', 'coding.guided-implementation', 6);
  state = await playRound(second, game, player, 'coding', 'coding.guided-implementation', 12);
  state = await playRound(second, game, player, 'coding', 'coding.guided-implementation', 18);
  expect(state.currentRound?.effectBreakdown?.pipeline?.deliverySpeed).toBe(-4);
  expect(state.currentRound?.effectBreakdown?.decision.deliverySpeed ?? 0).toBe(0);
  expect(state.metrics.deliverySpeed).toBe(-5);
  await closeTrackedApp(second);
  rmSync(directory, { force: true, recursive: true });
});

it('продолжает старую игру из активного голосования после миграции', async () => {
  const { databasePath, directory } = temporaryDatabase('ai-sdlc-legacy-flow-');
  seedLegacyGame(databasePath);
  const app = await testApp(databasePath);
  const player = await joinGame(app, 'OLD234', 'Ира');
  let state = await getState(app, 'OLD234');
  expect(state.currentBallot?.kind).toBe('LEGACY_OPTION');
  expect(state.metricBounds).toEqual({ maximum: 100, minimum: 0 });
  expect(state.metricDefinitions.deliverySpeed.label).toBe('TTM');
  const optionId = state.currentRound?.options[0]?.id ?? '';
  await vote(app, 'OLD234', player.playerToken, { optionId });
  state = await legacyCommand(app, 'CLOSE_VOTING', 0);
  state = await legacyCommand(app, 'SHOW_EVENT', 1);
  state = await legacyCommand(app, 'APPLY_CONSEQUENCES', 2);
  expect(state.decisionModel).toBe('SINGLE_OPTION_V1');
  expect(state.stages.testing).toBe('BROKEN');
  expect(state.phase).toBe('WON');
  await closeTrackedApp(app);
  rmSync(directory, { force: true, recursive: true });
});

it.each([
  'RESULT',
  'EVENT',
] as const)('продолжает старую игру из фазы %s после миграции', async (phase) => {
  const { databasePath, directory } = temporaryDatabase(`ai-sdlc-legacy-${phase}-`);
  seedLegacyGame(databasePath, phase);
  const app = await testApp(databasePath);
  let state = await getState(app, 'OLD234');
  expect(state.currentBallot?.selectedChoiceId).toBe('old-a');
  if (phase === 'RESULT') state = await legacyCommand(app, 'SHOW_EVENT', 0);
  expect(state.currentRound?.metricImpact).toBe('NEUTRAL');
  state = await legacyCommand(app, 'APPLY_CONSEQUENCES', phase === 'RESULT' ? 1 : 0);
  expect(state.phase).toBe('WON');
  await closeTrackedApp(app);
  rmSync(directory, { force: true, recursive: true });
});

async function testApp(databasePath = ':memory:', scenario?: Scenario) {
  const app = await createApp({ databasePath, scenario });
  openApps.push(app);
  return app;
}

async function createGame(app: FastifyInstance) {
  const response = await app.inject({ method: 'POST', url: '/api/games' });
  expect(response.statusCode).toBe(200);
  return response.json() as CreateGameResponse;
}

async function joinGame(app: FastifyInstance, code: string, name: string) {
  const response = await app.inject({
    method: 'POST',
    payload: { name },
    url: `/api/games/${code}/join`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as JoinGameResponse;
}

async function vote(app: FastifyInstance, code: string, token: string, payload: VoteRequest) {
  return app.inject({
    headers: { authorization: `Bearer ${token}` },
    method: 'PUT',
    payload,
    url: `/api/games/${code}/vote`,
  });
}

async function voteFor(
  app: FastifyInstance,
  game: CreateGameResponse,
  player: JoinGameResponse,
  ballotId: string,
  choiceId: string | undefined,
) {
  if (!choiceId) throw new Error('Нет варианта');
  const response = await vote(app, game.state.code, player.playerToken, { ballotId, choiceId });
  expect(response.statusCode).toBe(200);
}

async function getState(app: FastifyInstance, code: string, token?: string) {
  const response = await app.inject({
    headers: token ? { authorization: `Bearer ${token}` } : {},
    method: 'GET',
    url: `/api/games/${code}/state`,
  });
  expect(response.statusCode).toBe(200);
  return response.json() as GameState;
}

async function command(
  app: FastifyInstance,
  game: CreateGameResponse,
  type: AdminCommandName,
  version: number,
  choiceId?: string,
) {
  const response = await rawCommand(app, game, type, version, choiceId);
  expect(response.statusCode).toBe(200);
  return (response.json() as { state: GameState }).state;
}

async function rawCommand(
  app: FastifyInstance,
  game: CreateGameResponse,
  type: AdminCommandName,
  version: number,
  choiceId?: string,
) {
  return app.inject({
    headers: { authorization: `Bearer ${game.adminToken}` },
    method: 'POST',
    payload: { choiceId, expectedTransitionVersion: version, type },
    url: `/api/games/${game.state.code}/admin/commands`,
  });
}

async function openActionBallot(
  app: FastifyInstance,
  game: CreateGameResponse,
  player: JoinGameResponse,
  stage: StageKey,
  version: number,
) {
  let state = await command(app, game, 'OPEN_VOTING', version);
  const stageBallot = requiredBallot(state);
  await voteFor(app, game, player, stageBallot.id, stage);
  state = await command(app, game, 'CLOSE_VOTING', version + 1);
  state = await command(app, game, 'OPEN_NEXT_BALLOT', version + 2);
  return { stageBallot, state };
}

function playBusinessAction(
  app: FastifyInstance,
  game: CreateGameResponse,
  player: JoinGameResponse,
  actionId: string,
  version: number,
) {
  return playRound(app, game, player, 'businessRequest', actionId, version);
}

function expectBusinessActivation(state: GameState) {
  const activation = state.currentRound?.activatedActions?.[0];
  expect(state.stages.businessRequest).toBe('AI_ENABLED');
  expect(activation).toMatchObject({
    actionId: 'businessRequest.feedback-mcp',
    completedByActionId: 'businessRequest.outcome-metrics',
    stage: 'businessRequest',
  });
  expect(activation?.title).toBe(
    defaultScenario.stageActions['businessRequest.feedback-mcp']?.title,
  );
  expect(activation?.completedByTitle).toBe(
    defaultScenario.stageActions['businessRequest.outcome-metrics']?.title,
  );
  expect(state.stageProgress.businessRequest.activeAiAction?.actionId).toBe(
    'businessRequest.feedback-mcp',
  );
  expect(
    state.stageProgress.businessRequest.appliedActions.map(({ actionId }) => actionId),
  ).toEqual(['businessRequest.feedback-mcp', 'businessRequest.outcome-metrics']);
}

async function playRound(
  app: FastifyInstance,
  game: CreateGameResponse,
  player: JoinGameResponse,
  stage: StageKey,
  actionId: string,
  version: number,
) {
  const opened = await openActionBallot(app, game, player, stage, version);
  return finishAction(app, game, player, actionId, version + 3, opened.state);
}

async function finishAction(
  app: FastifyInstance,
  game: CreateGameResponse,
  player: JoinGameResponse,
  actionId: string,
  version: number,
  state: GameState,
) {
  await voteFor(app, game, player, requiredBallot(state).id, actionId);
  await command(app, game, 'CLOSE_VOTING', version);
  await command(app, game, 'SHOW_EVENT', version + 1);
  return command(app, game, 'APPLY_CONSEQUENCES', version + 2);
}

function requiredBallot(state: GameState) {
  if (!state.currentBallot) throw new Error('Нет бюллетеня');
  return state.currentBallot;
}

function tally(state: GameState, choiceId: string) {
  return state.currentBallot?.voteTallies.find((item) => item.choiceId === choiceId)?.count;
}

function noRoundsScenario(): Scenario {
  return {
    ...defaultScenario,
    rules: { ...defaultScenario.rules, roundLimit: 0, roundMode: 'FINITE' },
  };
}

const winningActions: [StageKey, string][] = [
  ['businessRequest', 'businessRequest.expected-outcome'],
  ['productDiscovery', 'productDiscovery.requirement-draft'],
  ['technicalDiscovery', 'technicalDiscovery.code-research'],
  ['coding', 'coding.guided-implementation'],
  ['testing', 'testing.ai-checks-with-qa'],
  ['review', 'review.context-and-human-risk'],
  ['deployment', 'deployment.human-approved-plan'],
  ['support', 'support.change-linked-signals'],
];

function scenarioWithContextQuality(quality: number): Scenario {
  return {
    ...defaultScenario,
    mechanics: {
      ...defaultScenario.mechanics,
      propertyEffects: {
        ...defaultScenario.mechanics.propertyEffects,
        currentContext: { quality },
      },
      stageStateEffects: { AI_ENABLED: {}, AS_IS: {}, BROKEN: { deliverySpeed: -2 } },
    },
  };
}

function scenarioWithBlockedActivation(): Scenario {
  const scenario = structuredClone(defaultScenario);
  const foundation = scenario.stageActions['businessRequest.outcome-metrics'];
  const aiAction = scenario.stageActions['businessRequest.feedback-mcp'];
  if (!foundation?.stageTransitions) throw new Error('Нет переходов подготовительного решения');
  if (!aiAction) throw new Error('Нет AI-решения для обратной связи');
  foundation.stageTransitions.BROKEN = 'BROKEN';
  aiAction.recovery = recoveryGuide;
  const rule = scenario.rounds[0]?.eventRules.find(
    ({ event }) => event.id === 'event-feedback-mcp-without-metrics',
  );
  if (!rule) throw new Error('Нет события для MCP без продуктовых метрик');
  rule.event.stageChanges = [{ stage: 'businessRequest', state: 'BROKEN' }];
  rule.event.recovery = recoveryGuide;
  return scenario;
}

const recoveryHostHint = 'Сначала добавьте продуктовые метрики, затем почините этап.';
const recoveryGuide = {
  hostHint: recoveryHostHint,
  prerequisiteActionIds: ['businessRequest.outcome-metrics'],
  repairActionIds: ['businessRequest.production-signals'],
};

function actionView(actionId: string) {
  const action = defaultScenario.stageActions[actionId];
  if (!action) throw new Error(`Нет решения ${actionId}`);
  return { actionId, stage: action.stage, title: action.title };
}

function scenarioWithOneStage(): Scenario {
  const [first, ...rest] = defaultScenario.rounds;
  if (!first) throw new Error('Нет раундов');
  return {
    ...defaultScenario,
    rounds: [{ ...first, stageChoices: first.stageChoices.slice(0, 1) }, ...rest],
  };
}

function scenarioWithTwoTemplates(): Scenario {
  const first = defaultScenario.rounds[0];
  if (!first) throw new Error('Нет шаблона хода');
  const second = { ...structuredClone(first), id: 'old-turn-2', number: 2 };
  second.title = 'Старый второй шаблон';
  return {
    ...defaultScenario,
    rounds: [first, second],
    rules: { ...defaultScenario.rules, roundLimit: 2 },
  };
}

function scenarioWithTemplateId(id: string): Scenario {
  const first = defaultScenario.rounds[0];
  if (!first) throw new Error('Нет шаблона хода');
  return { ...defaultScenario, rounds: [{ ...first, id }] };
}

function expectOldCycleOrder(...states: GameState[]) {
  expect(states.map((state) => state.currentRound?.title)).toEqual([
    'За какой этап возьмёмся сейчас?',
    'Старый второй шаблон',
    'За какой этап возьмёмся сейчас?',
  ]);
}

async function closeTrackedApp(app: FastifyInstance) {
  await app.close();
  openApps.splice(openApps.indexOf(app), 1);
}

function temporaryDatabase(prefix: string) {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return { databasePath: join(directory, 'game.sqlite'), directory };
}

function seedLegacyGame(databasePath: string, phase: 'VOTING' | 'RESULT' | 'EVENT' = 'VOTING') {
  const database = new DatabaseSync(databasePath);
  database.exec(legacySeedSchema);
  const now = new Date().toISOString();
  database.prepare(legacyGameSql).run(
    phase,
    JSON.stringify(defaultScenario.mechanics.initialMetrics),
    JSON.stringify(createInitialStages()),
    JSON.stringify({
      ...defaultScenario.rules,
      minAiStagesToWin: 1,
      requireNoBrokenStages: false,
      roundLimit: 1,
      roundMode: 'FINITE',
    }),
    hashToken('legacy-admin'),
    now,
    now,
  );
  database.prepare(legacyRoundSql).run(JSON.stringify([legacyEvent()]));
  for (const option of legacyOptions()) insertLegacyOption(database, option);
  seedLegacyRoundState(database, phase);
  database.close();
}

const legacyGameSql = `INSERT INTO games (
  id, code, phase, metrics_json, properties_json, stages_json, rules_json,
  scenario_version, admin_token_hash, created_at, updated_at
) VALUES ('legacy', 'OLD234', ?, ?, '[]', ?, ?, 1, ?, ?, ?)`;

const legacyRoundSql = `INSERT INTO game_rounds (
  id, game_id, round_number, title, situation, event_rules_json
) VALUES ('legacy:r1', 'legacy', 1, 'Старый раунд', 'Ситуация', ?)`;

function legacyOptions(): EngineOption[] {
  return ['old-a', 'old-b'].map((id, index) => ({
    addProperties: [],
    description: `Вариант ${index + 1}`,
    effect: {},
    evidence: 'SCENARIO',
    id,
    key: String.fromCharCode(65 + index),
    shortFeedback: 'Разбор',
    stage: 'coding',
    stageChanges: [
      { stage: 'coding', state: 'AI_ENABLED' },
      { stage: 'testing', state: 'BROKEN' },
    ],
    title: `Вариант ${index + 1}`,
  }));
}

function legacyEvent() {
  return {
    event: {
      description: 'Старое событие',
      effect: {},
      evidence: 'SCENARIO',
      id: 'old-event',
      stageChanges: [],
      title: 'Событие',
    },
  };
}

function insertLegacyOption(database: DatabaseSync, option: EngineOption) {
  const sql = `INSERT INTO round_options (round_id, id, option_key, payload_json)
    VALUES ('legacy:r1', ?, ?, ?)`;
  database.prepare(sql).run(option.id, option.key, JSON.stringify(option));
}

function seedLegacyRoundState(database: DatabaseSync, phase: 'VOTING' | 'RESULT' | 'EVENT') {
  if (phase === 'VOTING') return;
  database.exec("UPDATE game_rounds SET selected_option_id = 'old-a' WHERE id = 'legacy:r1'");
  if (phase !== 'EVENT') return;
  const event = legacyEvent().event;
  const sql = `UPDATE game_rounds SET shown_event_json = ?, pending_plan_json = ?
    WHERE id = 'legacy:r1'`;
  database.prepare(sql).run(JSON.stringify(event), JSON.stringify(legacyPlan(event)));
}

function legacyPlan(event: ReturnType<typeof legacyEvent>['event']) {
  const stages = createInitialStages();
  stages.coding = 'AI_ENABLED';
  const empty = { controllability: 0, deliverySpeed: 0, quality: 0, teamCapacity: 0 };
  return {
    appliedActions: [],
    breakdown: { decision: empty, event: empty, properties: empty, total: empty },
    event,
    metrics: defaultScenario.mechanics.initialMetrics,
    properties: [],
    stages,
  };
}

const legacySeedSchema = `
CREATE TABLE games (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, phase TEXT NOT NULL,
  current_round INTEGER NOT NULL DEFAULT 0, metrics_json TEXT NOT NULL,
  properties_json TEXT NOT NULL, stages_json TEXT NOT NULL, rules_json TEXT NOT NULL,
  scenario_version INTEGER NOT NULL, transition_version INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0, admin_token_hash TEXT NOT NULL, outcome_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE game_rounds (
  id TEXT PRIMARY KEY, game_id TEXT NOT NULL, round_number INTEGER NOT NULL,
  title TEXT NOT NULL, situation TEXT NOT NULL, event_rules_json TEXT NOT NULL,
  selected_option_id TEXT, tied_option_ids_json TEXT NOT NULL DEFAULT '[]',
  shown_event_json TEXT, pending_plan_json TEXT, applied_at TEXT,
  UNIQUE(game_id, round_number)
);
CREATE TABLE round_options (
  round_id TEXT NOT NULL, id TEXT NOT NULL, option_key TEXT NOT NULL,
  payload_json TEXT NOT NULL, PRIMARY KEY(round_id, id), UNIQUE(round_id, option_key)
);`;

async function legacyCommand(app: FastifyInstance, type: AdminCommandName, version: number) {
  const response = await app.inject({
    headers: { authorization: 'Bearer legacy-admin' },
    method: 'POST',
    payload: { expectedTransitionVersion: version, type },
    url: '/api/games/OLD234/admin/commands',
  });
  expect(response.statusCode).toBe(200);
  return (response.json() as { state: GameState }).state;
}
