import type { AdminForecast, GameState } from '@ai-sdlc/contracts';
import { useEffect, useState } from 'react';
import { api } from '../api/client';

export function useAdminForecast(code: string, token: string, state: GameState) {
  const [forecast, setForecast] = useState<AdminForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ballotId = state.currentBallot?.id ?? null;
  const version = state.transitionVersion;
  useEffect(() => {
    setForecast(null);
    setError(null);
    if (!ballotId || !['VOTING', 'RESULT'].includes(state.phase)) {
      return;
    }
    let active = true;
    matchingForecast(code, token, ballotId, version).then(
      (next) => {
        if (!active) return;
        setForecast(next);
      },
      (caught) => {
        if (!active) return;
        setForecast(null);
        setError(caught instanceof Error ? caught.message : 'Не загрузились подсказки ведущего.');
      },
    );
    return () => {
      active = false;
    };
  }, [ballotId, code, state.phase, token, version]);
  return { error, forecast };
}

async function matchingForecast(code: string, token: string, ballotId: string, version: number) {
  const forecast = await api.getAdminForecast(code, token);
  if (forecast.ballotId !== ballotId || forecast.transitionVersion !== version) return null;
  return forecast;
}
