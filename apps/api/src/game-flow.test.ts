import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AdminCommandName,
  CreateGameResponse,
  GameState,
  JoinGameResponse,
} from '@ai-sdlc/contracts';
import { defaultScenario, type Scenario } from '@ai-sdlc/game-engine';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';

const openApps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

it('заменяет голос и запрещает голосовать после закрытия', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  let state = await command(app, game, 'OPEN_VOTING', 0);
  const [first, second] = state.currentRound?.options ?? [];
  if (!first || !second) throw new Error('Нет вариантов');
  await vote(app, game.state.code, player.playerToken, first.id);
  await vote(app, game.state.code, player.playerToken, second.id);
  state = await command(app, game, 'CLOSE_VOTING', 1);
  expect(state.currentRound?.voteTallies.find((item) => item.optionId === first.id)?.count).toBe(0);
  expect(state.currentRound?.voteTallies.find((item) => item.optionId === second.id)?.count).toBe(
    1,
  );
  const response = await vote(app, game.state.code, player.playerToken, first.id);
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

it('применяет решение и последствия только один раз', async () => {
  const app = await testApp();
  const game = await createGame(app);
  let state = await command(app, game, 'OPEN_VOTING', 0);
  state = await command(app, game, 'CLOSE_VOTING', 1);
  const leader = state.currentRound?.tiedOptionIds[2];
  if (!leader) throw new Error('Ожидалась ничья без голосов');
  state = await command(app, game, 'RESOLVE_TIE', 2, leader);
  state = await command(app, game, 'SHOW_EVENT', 3);
  expect(state.phase).toBe('EVENT');
  expect(state.currentRound?.event).not.toHaveProperty('effect');
  expect(state.currentRound?.event).not.toHaveProperty('stageChanges');
  state = await command(app, game, 'APPLY_CONSEQUENCES', 4);
  const response = await rawCommand(app, game, 'APPLY_CONSEQUENCES', 5);
  expect(state.phase).toBe('FEEDBACK');
  expect(response.statusCode).toBe(409);
});

it('при ничьей разрешает выбрать только лидирующий вариант', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const firstPlayer = await joinGame(app, game.state.code, 'Ира');
  const secondPlayer = await joinGame(app, game.state.code, 'Олег');
  let state = await command(app, game, 'OPEN_VOTING', 0);
  const [first, second, notLeader] = state.currentRound?.options ?? [];
  if (!first || !second || !notLeader) throw new Error('Нет вариантов');
  await vote(app, game.state.code, firstPlayer.playerToken, first.id);
  await vote(app, game.state.code, secondPlayer.playerToken, second.id);
  state = await command(app, game, 'CLOSE_VOTING', 1);
  expect(state.currentRound?.tiedOptionIds).toEqual([first.id, second.id]);
  const response = await rawCommand(app, game, 'RESOLVE_TIE', 2, notLeader.id);
  expect(response.statusCode).toBe(400);
  expect(response.json().code).toBe('NOT_A_LEADER');
});

it('не раскрывает игровые эффекты вместе с публичным вариантом', async () => {
  const app = await testApp();
  const game = await createGame(app);
  expect(game.state.currentRound).toBeNull();
  const state = await command(app, game, 'OPEN_VOTING', 0);
  const option = state.currentRound?.options[0];
  expect(option).toBeDefined();
  expect(option?.shortFeedback).toBeNull();
  expect(option).not.toHaveProperty('effect');
  expect(option).not.toHaveProperty('addProperties');
  expect(option).not.toHaveProperty('stageChanges');
  const result = await command(app, game, 'CLOSE_VOTING', 1);
  expect(result.currentRound?.options[0]?.shortFeedback).toBeTypeOf('string');
});

it('восстанавливает личный голос только по токену игрока', async () => {
  const app = await testApp();
  const game = await createGame(app);
  const player = await joinGame(app, game.state.code, 'Ира');
  const state = await command(app, game, 'OPEN_VOTING', 0);
  const optionId = state.currentRound?.options[0]?.id;
  if (!optionId) throw new Error('Нет варианта');
  await vote(app, game.state.code, player.playerToken, optionId);
  const personal = await getState(app, game.state.code, player.playerToken);
  const publicState = await getState(app, game.state.code);
  expect(personal.myVoteOptionId).toBe(optionId);
  expect(publicState.myVoteOptionId).toBeNull();
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
  it('возвращает игру после повторного открытия базы', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-game-'));
    const databasePath = join(directory, 'game.sqlite');
    const first = await testApp(databasePath);
    const game = await createGame(first);
    await first.close();
    openApps.splice(openApps.indexOf(first), 1);
    const second = await testApp(databasePath);
    const response = await second.inject({
      method: 'GET',
      url: `/api/games/${game.state.code}/state`,
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as GameState).code).toBe(game.state.code);
    await second.close();
    openApps.splice(openApps.indexOf(second), 1);
    rmSync(directory, { force: true, recursive: true });
  });
});

it('после перезапуска использует сохранённые правила игры', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-rules-'));
  const databasePath = join(directory, 'game.sqlite');
  const scenario = noRoundsScenario();
  const first = await testApp(databasePath, scenario);
  const game = await createGame(first);
  await closeTrackedApp(first);
  const second = await testApp(databasePath);
  const response = await rawCommand(second, game, 'OPEN_VOTING', 0);
  expect(response.statusCode).toBe(409);
  expect(response.json().code).toBe('NO_MORE_ROUNDS');
  await closeTrackedApp(second);
  rmSync(directory, { force: true, recursive: true });
});

it('после перезапуска использует сохранённую механику', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-mechanics-'));
  const databasePath = join(directory, 'game.sqlite');
  const scenario = scenarioWithContextQuality(20);
  const first = await testApp(databasePath, scenario);
  const game = await createGame(first);
  await closeTrackedApp(first);
  const second = await testApp(databasePath);
  const player = await joinGame(second, game.state.code, 'Ира');
  let state = await command(second, game, 'OPEN_VOTING', 0);
  const optionId = state.currentRound?.options[0]?.id;
  if (!optionId) throw new Error('Нет варианта');
  await vote(second, game.state.code, player.playerToken, optionId);
  state = await command(second, game, 'CLOSE_VOTING', 1);
  state = await command(second, game, 'SHOW_EVENT', 2);
  state = await command(second, game, 'APPLY_CONSEQUENCES', 3);
  expect(state.metrics.quality).toBe(80);
  await closeTrackedApp(second);
  rmSync(directory, { force: true, recursive: true });
});

async function testApp(databasePath = ':memory:', scenario?: Scenario) {
  const app = await createApp({ databasePath, scenario });
  openApps.push(app);
  return app;
}

async function closeTrackedApp(app: FastifyInstance) {
  await app.close();
  openApps.splice(openApps.indexOf(app), 1);
}

function noRoundsScenario(): Scenario {
  return {
    ...defaultScenario,
    rules: { ...defaultScenario.rules, roundLimit: 0 },
  };
}

function scenarioWithContextQuality(quality: number): Scenario {
  return {
    ...defaultScenario,
    mechanics: {
      ...defaultScenario.mechanics,
      propertyEffects: {
        ...defaultScenario.mechanics.propertyEffects,
        currentContext: { quality },
      },
    },
  };
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
  return response.json() as JoinGameResponse;
}

async function vote(app: FastifyInstance, code: string, token: string, optionId: string) {
  return app.inject({
    headers: { authorization: `Bearer ${token}` },
    method: 'PUT',
    payload: { optionId },
    url: `/api/games/${code}/vote`,
  });
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
  optionId?: string,
) {
  const response = await rawCommand(app, game, type, version, optionId);
  expect(response.statusCode).toBe(200);
  return (response.json() as { state: GameState }).state;
}

async function rawCommand(
  app: FastifyInstance,
  game: CreateGameResponse,
  type: AdminCommandName,
  version: number,
  optionId?: string,
) {
  return app.inject({
    headers: { authorization: `Bearer ${game.adminToken}` },
    method: 'POST',
    payload: { expectedTransitionVersion: version, optionId, type },
    url: `/api/games/${game.state.code}/admin/commands`,
  });
}
