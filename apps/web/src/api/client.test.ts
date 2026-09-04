import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './client';

describe('api.join', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('отправляет совместимое внутреннее имя без данных участника', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}), ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await api.join('ABC234');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/api/games/ABC234/join');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'Участник' }));
  });
});

describe('доступ ведущего', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('передаёт заданный код при создании игры', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}), ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await api.createGame({ code: 'DTN026' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/api/games');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ code: 'DTN026' }));
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
  });

  it('отправляет пароль ведущего отдельно от адреса комнаты', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({}), ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await api.loginAdmin('DTN026', 'ABCD-EFGH-JKLM');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:8787/api/games/DTN026/admin/login');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ password: 'ABCD-EFGH-JKLM' }));
  });
});
