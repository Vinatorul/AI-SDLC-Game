import type { ScenarioPresentation } from '@ai-sdlc/contracts';
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { api } from '../api/client';
import { PresentationProvider } from '../presentation';

export function ScenarioEntry() {
  const [attempt, setAttempt] = useState(0);
  return <ScenarioLoader key={attempt} retry={() => setAttempt((value) => value + 1)} />;
}

function ScenarioLoader({ retry }: { retry: () => void }) {
  const [presentation, setPresentation] = useState<ScenarioPresentation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void api.getScenario().then(
      (result) => active && setPresentation(result.presentation),
      () => active && setError('Не получилось загрузить игру.'),
    );
    return () => {
      active = false;
    };
  }, []);
  if (!presentation) return <ScenarioLoading error={error} retry={retry} />;
  return (
    <PresentationProvider presentation={presentation}>
      <Outlet />
    </PresentationProvider>
  );
}

function ScenarioLoading({ error, retry }: { error: string | null; retry: () => void }) {
  return (
    <main className="single-page">
      <p>{error ?? 'Загружаем игру…'}</p>
      {error && (
        <button onClick={retry} type="button">
          Попробовать ещё раз
        </button>
      )}
    </main>
  );
}
