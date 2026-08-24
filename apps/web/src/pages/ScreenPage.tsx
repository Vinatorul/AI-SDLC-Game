import { QRCodeSVG } from 'qrcode.react';
import { useNavigate, useParams } from 'react-router-dom';
import { CodeEntry } from '../components/CodeEntry';
import { GameFocus } from '../components/GameFocus';
import { GameHeader } from '../components/GameHeader';
import { Layout } from '../components/Layout';
import { MetricBoard } from '../components/MetricBoard';
import { StageMap } from '../components/StageMap';
import { useGameState } from '../realtime/useGameState';

export function ScreenPage() {
  const navigate = useNavigate();
  const { code } = useParams();
  const game = useGameState(code);
  if (!code) return <ScreenEntry onSubmit={(value) => navigate(`/screen/${value}`)} />;
  if (game.error) return <ScreenMessage error message={game.error} />;
  if (!game.state) return <ScreenMessage message="Загружаем игру…" />;
  return <ActiveScreen code={code} connected={game.connected} state={game.state} />;
}

function ActiveScreen({
  code,
  connected,
  state,
}: {
  code: string;
  connected: boolean;
  state: NonNullable<ReturnType<typeof useGameState>['state']>;
}) {
  return (
    <Layout compact>
      <main className="game-page screen-page">
        <GameHeader connected={connected} state={state} title="Экран зала" />
        <div className="screen-topline">
          <MetricBoard breakdown={state.currentRound?.effectBreakdown} state={state} />
          <JoinQr code={code} />
        </div>
        <GameFocus state={state} />
        <StageMap state={state} />
      </main>
    </Layout>
  );
}

function ScreenEntry({ onSubmit }: { onSubmit: (value: string) => void }) {
  return (
    <Layout>
      <main className="single-page">
        <CodeEntry
          action="Открыть"
          description="Введите код уже созданной комнаты."
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
