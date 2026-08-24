import type { Scenario } from '@ai-sdlc/game-engine';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError, z } from 'zod';
import { readBearerToken } from './auth';
import { openDatabase } from './db/database';
import { AppError } from './errors';
import { GameService } from './game-service';
import { GameHub } from './realtime/game-hub';

const codeParams = z.object({ code: z.string().min(4).max(12) });
const joinBody = z.object({ name: z.string().trim().min(1).max(40) });
const voteBody = z.union([
  z.object({ ballotId: z.string().min(1).max(80), choiceId: z.string().min(1).max(80) }),
  z.object({ optionId: z.string().min(1).max(80) }),
]);
const commandBody = z.object({
  choiceId: z.string().min(1).max(80).optional(),
  expectedTransitionVersion: z.number().int().nonnegative(),
  optionId: z.string().min(1).max(80).optional(),
  type: z.enum([
    'OPEN_VOTING',
    'OPEN_NEXT_BALLOT',
    'CLOSE_VOTING',
    'RESOLVE_TIE',
    'SHOW_EVENT',
    'APPLY_CONSEQUENCES',
  ]),
});

export type AppOptions = {
  allowedOrigins?: string[];
  databasePath: string;
  logger?: boolean;
  scenario?: Scenario;
};

export async function createApp(options: AppOptions) {
  const database = openDatabase(options.databasePath);
  const hub = new GameHub();
  const service = new GameService(database, hub, options.scenario);
  const app = Fastify({ logger: options.logger ?? false });
  const origins = options.allowedOrigins ?? defaultOrigins();
  await app.register(cors, {
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'],
    origin: corsOrigin(origins),
  });
  await app.register(websocket);
  registerHttpRoutes(app, service);
  registerWebSocketRoute(app, service, hub, origins);
  app.setErrorHandler(errorHandler);
  app.addHook('onClose', () => database.close());
  return app;
}

function registerHttpRoutes(app: FastifyInstance, service: GameService) {
  app.get('/health', async () => service.health());
  app.post('/api/games', async () => service.createGame());
  app.post('/api/games/:code/join', async (request) => {
    const { code } = codeParams.parse(request.params);
    const { name } = joinBody.parse(request.body);
    return service.join(normalizeCode(code), name);
  });
  app.get('/api/games/:code/state', async (request) => {
    const { code } = codeParams.parse(request.params);
    return service.getState(normalizeCode(code), optionalBearer(request));
  });
  app.put('/api/games/:code/vote', async (request) => {
    const { code } = codeParams.parse(request.params);
    const vote = voteBody.parse(request.body);
    return service.vote(normalizeCode(code), bearer(request), vote);
  });
  app.post('/api/games/:code/admin/commands', async (request) => {
    const { code } = codeParams.parse(request.params);
    const command = commandBody.parse(request.body);
    return { state: service.command(normalizeCode(code), bearer(request), command) };
  });
}

function registerWebSocketRoute(
  app: FastifyInstance,
  service: GameService,
  hub: GameHub,
  origins: string[],
) {
  app.get('/api/games/:code/ws', { websocket: true }, (socket, request) => {
    const { code } = codeParams.parse(request.params);
    if (!originAllowed(request.headers.origin, origins))
      return socket.close(1008, 'Origin rejected');
    const normalized = normalizeCode(code);
    const state = service.getState(normalized);
    const remove = hub.add(normalized, socket);
    socket.send(JSON.stringify({ revision: state.revision, type: 'revision' }));
    socket.on('close', remove);
  });
}

function bearer(request: FastifyRequest) {
  const token = readBearerToken(request.headers.authorization);
  if (!token) throw new AppError(401, 'TOKEN_REQUIRED', 'Нужен токен доступа');
  return token;
}

function optionalBearer(request: FastifyRequest) {
  if (!request.headers.authorization) return undefined;
  return bearer(request);
}

function normalizeCode(code: string) {
  return code.trim().toUpperCase();
}

function defaultOrigins() {
  return ['http://127.0.0.1:5173', 'http://localhost:5173'];
}

function originAllowed(origin: string | undefined, allowed: string[]) {
  return !origin || allowed.includes(origin);
}

function corsOrigin(allowed: string[]) {
  return (origin: string | undefined, callback: (error: Error | null, value: boolean) => void) => {
    if (originAllowed(origin, allowed)) return callback(null, true);
    return callback(new Error('Origin rejected'), false);
  };
}

function errorHandler(error: Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      code: error.code,
      message: error.message,
      ...(error.state ? { state: error.state } : {}),
    });
  }
  if (error instanceof ZodError) {
    return reply.status(400).send({ code: 'INVALID_REQUEST', message: 'Проверьте данные запроса' });
  }
  const statusCode = 'statusCode' in error ? Number(error.statusCode) : 0;
  if (statusCode >= 400 && statusCode < 500) {
    return reply
      .status(statusCode)
      .send({ code: 'INVALID_REQUEST', message: 'Некорректный запрос' });
  }
  request.log.error(error);
  return reply.status(500).send({ code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' });
}
