import type { AdminCommandName, GameState } from '@ai-sdlc/contracts';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { adminTokenKey } from '../api/storage';
import { GameFocus } from '../components/GameFocus';
import { GameHeader } from '../components/GameHeader';
import { Layout } from '../components/Layout';
import { MetricBoard } from '../components/MetricBoard';
import { StageMap } from '../components/StageMap';
import { useGameState } from '../realtime/useGameState';

export function AdminPage() {
  const { code } = useParams();
  const game = useGameState(code);
  if (!code) return <AdminStart />;
  const token = sessionStorage.getItem(adminTokenKey(code));
  if (!token) return <MissingAdminToken code={code} />;
  if (game.error) return <PageError message={game.error} />;
  if (!game.state) return <PageLoading />;
  return <AdminGame code={code} game={game} token={token} />;
}

function AdminStart() {
  const createGame = useCreateGame();
  return (
    <Layout>
      <main className="single-page">
        <section className="entry-card">
          <p className="eyebrow">Экран ведущего</p>
          <h1>Новая игра</h1>
          <p>Сервер создаст комнату, сохранит сценарий и выдаст одноразовый секрет ведущего.</p>
          {createGame.error && <p className="form-error">{createGame.error}</p>}
          <button
            className="primary-button"
            disabled={createGame.busy}
            onClick={createGame.run}
            type="button"
          >
            {createGame.busy ? 'Создаём…' : 'Создать игру'}
          </button>
        </section>
      </main>
    </Layout>
  );
}

function useCreateGame() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createGame();
      sessionStorage.setItem(adminTokenKey(result.state.code), result.adminToken);
      navigate(`/admin/${result.state.code}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось создать игру');
      setBusy(false);
    }
  }
  return { busy, error, run };
}

type AdminGameProps = {
  code: string;
  game: ReturnType<typeof useGameState>;
  token: string;
};

function AdminGame({ code, game, token }: AdminGameProps) {
  const state = game.state as GameState;
  return (
    <Layout>
      <main className="game-page">
        <GameHeader connected={game.connected} state={state} title="Пульт ведущего" />
        <MetricBoard breakdown={state.currentRound?.effectBreakdown} state={state} />
        <div className="admin-layout">
          <div>
            <GameFocus state={state} />
            <StageMap state={state} />
          </div>
          <aside>
            <AdminControls code={code} game={game} state={state} token={token} />
            <SharePanel code={code} state={state} />
          </aside>
        </div>
      </main>
    </Layout>
  );
}

function AdminControls({ code, game, state, token }: AdminGameProps & { state: GameState }) {
  const command = useAdminCommand(code, game, state, token);
  return (
    <section className="control-panel">
      <p className="eyebrow">Следующий шаг</p>
      <h2>{controlTitle(state)}</h2>
      <p>
        {state.playerCount} игроков · {state.voteCount} голосов
      </p>
      {command.error && <p className="form-error">{command.error}</p>}
      <ControlButtons busy={command.busy} send={command.send} state={state} />
    </section>
  );
}

function useAdminCommand(
  code: string,
  game: ReturnType<typeof useGameState>,
  state: GameState,
  token: string,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(type: AdminCommandName, optionId?: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api.command(code, token, {
        expectedTransitionVersion: state.transitionVersion,
        optionId,
        type,
      });
      game.setState(result.state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Команда не выполнена');
      await game.refresh();
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, send };
}

function ControlButtons({
  busy,
  send,
  state,
}: {
  busy: boolean;
  send: (type: AdminCommandName, optionId?: string) => void;
  state: GameState;
}) {
  if (state.allowedCommands.includes('RESOLVE_TIE')) {
    return <TieButtons busy={busy} send={send} state={state} />;
  }
  const command = state.allowedCommands[0];
  if (!command) return <p className="muted">Игра завершена.</p>;
  return (
    <button className="primary-button" disabled={busy} onClick={() => send(command)} type="button">
      {busy ? 'Применяем…' : commandLabels[command]}
    </button>
  );
}

function TieButtons({ busy, send, state }: Parameters<typeof ControlButtons>[0]) {
  return (
    <div className="tie-buttons">
      {state.currentRound?.tiedOptionIds.map((id) => {
        const option = state.currentRound?.options.find((item) => item.id === id);
        return (
          <button disabled={busy} key={id} onClick={() => send('RESOLVE_TIE', id)} type="button">
            {option?.key}: {option?.title}
          </button>
        );
      })}
    </div>
  );
}

function SharePanel({ code, state }: { code: string; state: GameState }) {
  const playerUrl = `${window.location.origin}${window.location.pathname}#/play/${code}`;
  return (
    <section className="share-panel">
      <p className="eyebrow">Подключение</p>
      <QRCodeSVG bgColor="#ffffff" fgColor="#111214" size={164} value={playerUrl} />
      <strong>{code}</strong>
      <Link to={`/screen/${code}`}>Открыть общий экран</Link>
      <small>
        Версия {state.transitionVersion} · ревизия {state.revision}
      </small>
    </section>
  );
}

function MissingAdminToken({ code }: { code: string }) {
  return (
    <Layout>
      <main className="single-page">
        <section className="entry-card">
          <p className="eyebrow">Комната {code}</p>
          <h1>Нет секрета ведущего</h1>
          <p>Откройте комнату в том браузере, где она была создана, или создайте новую.</p>
          <Link className="primary-button" to="/admin">
            Создать новую
          </Link>
        </section>
      </main>
    </Layout>
  );
}

function PageLoading() {
  return (
    <Layout>
      <main className="single-page">
        <p>Загружаем игру…</p>
      </main>
    </Layout>
  );
}

function PageError({ message }: { message: string }) {
  return (
    <Layout>
      <main className="single-page">
        <p className="form-error">{message}</p>
      </main>
    </Layout>
  );
}

function controlTitle(state: GameState) {
  if (state.phase === 'VOTING') return 'Закройте голосование, когда зал готов';
  if (state.phase === 'RESULT' && state.currentRound?.tiedOptionIds.length)
    return 'Выберите лидера';
  if (state.phase === 'RESULT') return 'Обсудите выбор перед событием';
  if (state.phase === 'EVENT') return 'Обсудите событие перед расчётом';
  if (state.phase === 'FEEDBACK') return 'Зафиксируйте изменения и идите дальше';
  return 'Откройте первый раунд';
}

const commandLabels: Record<AdminCommandName, string> = {
  APPLY_CONSEQUENCES: 'Применить последствия',
  CLOSE_VOTING: 'Закрыть голосование',
  OPEN_VOTING: 'Открыть голосование',
  RESOLVE_TIE: 'Выбрать победителя',
  SHOW_EVENT: 'Показать событие',
};
