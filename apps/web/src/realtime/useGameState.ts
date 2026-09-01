import type { GameState, RevisionMessage } from '@ai-sdlc/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, gameWebSocketUrl } from '../api/client';

export function useGameState(code: string | undefined, playerToken?: string) {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const revision = useRef(-1);
  const acceptState = useCallback((next: GameState) => {
    if (next.revision < revision.current) return;
    revision.current = next.revision;
    setState(next);
  }, []);
  const refresh = useCallback(async () => {
    if (!code) return;
    try {
      const next = await api.getState(code, playerToken);
      acceptState(next);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не получилось загрузить игру.');
    }
  }, [acceptState, code, playerToken]);
  useEffect(() => void refresh(), [refresh]);
  useEffect(() => connectStream(code, revision, refresh, setConnected), [code, refresh]);
  return { connected, error, refresh, setState: acceptState, state };
}

function connectStream(
  code: string | undefined,
  revision: React.RefObject<number>,
  refresh: () => Promise<void>,
  setConnected: (connected: boolean) => void,
) {
  if (!code) return undefined;
  let socket: WebSocket | undefined, retry: number | undefined;
  let active = true;
  const refreshQueue = createRefreshQueue(refresh);
  const open = () => {
    const next = new WebSocket(gameWebSocketUrl(code));
    socket = next;
    next.onopen = () => setConnected(true);
    next.onmessage = (event) => handleMessage(event.data, revision.current, refreshQueue.run);
    next.onerror = () => next.close();
    next.onclose = () => {
      setConnected(false);
      if (active) retry = window.setTimeout(open, 1500);
      if (active) void refresh();
    };
  };
  open();
  return () => {
    active = false;
    if (retry) window.clearTimeout(retry);
    refreshQueue.clear();
    socket?.close();
  };
}

function createRefreshQueue(refresh: () => Promise<void>) {
  let timer: number | undefined;
  return {
    clear: () => timer && window.clearTimeout(timer),
    run: () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void refresh(), 80);
    },
  };
}

function handleMessage(raw: string, currentRevision: number, refresh: () => void) {
  try {
    const message = JSON.parse(raw) as RevisionMessage;
    if (message.type === 'revision' && message.revision > currentRevision) void refresh();
  } catch {
    // Сервер присылает только JSON; повреждённое сообщение можно пропустить и восстановиться по HTTP.
  }
}
