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
