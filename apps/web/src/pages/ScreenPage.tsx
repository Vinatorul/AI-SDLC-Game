import type { GameState } from '@ai-sdlc/contracts';
import { QRCodeSVG } from 'qrcode.react';
import { useNavigate, useParams } from 'react-router-dom';
import { CodeEntry } from '../components/CodeEntry';
import { Layout } from '../components/Layout';
import { MetricBoard } from '../components/MetricBoard';
import { StageMap } from '../components/StageMap';
import { phaseLabels } from '../labels';
import { useGameState } from '../realtime/useGameState';

export function ScreenPage() {
  const navigate = useNavigate();
  const { code } = useParams();
  const game = useGameState(code);
  if (!code) return <ScreenEntry onSubmit={(value) => navigate(`/screen/${value}`)} />;
  if (game.error) return <ScreenMessage error message={game.error} />;
  if (!game.state) return <ScreenMessage message="Загружаем игру…" />;
  return <ScreenGameView code={code} state={game.state} />;
}

export function ScreenGameView({
  code,
  state,
}: {
  code: string;
  state: NonNullable<ReturnType<typeof useGameState>['state']>;
}) {
  return (
    <Layout bare>
      <main className="game-page screen-page">
        <section className="screen-dashboard">
          <ScreenCurrentPhase state={state} />
          <MetricBoard compact breakdown={state.currentRound?.effectBreakdown} state={state} />
          <StageMap compact state={state} />
          <JoinQr code={code} />
        </section>
      </main>
    </Layout>
  );
}

function ScreenCurrentPhase({ state }: { state: GameState }) {
  return (
    <section className="screen-current-phase" aria-live="polite">
      <p className="eyebrow">Текущая фаза</p>
      <h2>{phaseLabels[state.phase]}</h2>
    </section>
  );
}

function ScreenEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  return (
    <Layout>
      <main className="single-page">
        <CodeEntry
          action="Открыть"
          description="Введите код комнаты, которую создал ведущий."
          onSubmit={onSubmit}
          title="Общий экран"
        />
      </main>
    </Layout>
  );
}

function ScreenMessage({ error = false, message }: { error?: boolean; message: string }) {
  return (
    <Layout>
      <main className="single-page">
        <p className={error ? 'form-error' : undefined}>{message}</p>
      </main>
    </Layout>
  );
}

function JoinQr({ code }: { code: string }) {
  const url = `${window.location.origin}${window.location.pathname}#/play/${code}`;
  return (
    <aside className="screen-qr">
      <QRCodeSVG bgColor="#ffffff" fgColor="#111214" size={116} value={url} />
      <div>
        <small>Войти в игру</small>
        <strong>{code}</strong>
      </div>
    </aside>
  );
}
