import type {
  AdminCommand,
  AdminCommandResponse,
  ApiErrorBody,
  CreateGameResponse,
  GameState,
  JoinGameResponse,
  VoteResponse,
} from '@ai-sdlc/contracts';

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');

export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }
}

export const api = {
  command: (code: string, token: string, command: AdminCommand) =>
    request<AdminCommandResponse>(`/api/games/${code}/admin/commands`, {
      body: JSON.stringify(command),
      headers: authHeaders(token),
      method: 'POST',
    }),
  createGame: () => request<CreateGameResponse>('/api/games', { method: 'POST' }),
  getState: (code: string, token?: string) =>
    request<GameState>(`/api/games/${code}/state`, {
      ...(token ? { headers: authHeaders(token) } : {}),
    }),
  join: (code: string, name: string) =>
    request<JoinGameResponse>(`/api/games/${code}/join`, {
      body: JSON.stringify({ name }),
      method: 'POST',
    }),
  vote: (code: string, token: string, optionId: string) =>
    request<VoteResponse>(`/api/games/${code}/vote`, {
      body: JSON.stringify({ optionId }),
      headers: authHeaders(token),
      method: 'PUT',
    }),
};

export function gameWebSocketUrl(code: string) {
  const url = new URL(`${apiBase}/api/games/${code}/ws`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  });
  const body = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) throw new ApiClientError(response.status, body as ApiErrorBody);
  return body as T;
}

function authHeaders(token: string) {
  return { authorization: `Bearer ${token}` };
}
