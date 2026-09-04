import type { AdminCommandName, GameState } from '@ai-sdlc/contracts';
import { QRCodeSVG } from 'qrcode.react';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { adminTokenKey } from '../api/storage';
import { ActivatedActions } from '../components/ActivatedActions';
import { GameFocus } from '../components/GameFocus';
import { GameHeader } from '../components/GameHeader';
import { Layout } from '../components/Layout';
import { MetricBoard } from '../components/MetricBoard';
import { MetricChangeNotes } from '../components/MetricChangeNotes';
import { RecoveryGuides } from '../components/RecoveryGuides';
import { StageMap } from '../components/StageMap';
import { useAdminForecast } from '../realtime/useAdminForecast';
import { useGameState } from '../realtime/useGameState';

export function AdminPage() {
  const { code } = useParams();
  const game = useGameState(code);
  const access = useAdminAccess(code);
  if (!code) return <AdminStart />;
  if (!access.token) return <AdminLogin code={code} onLogin={access.save} />;
  if (game.error) return <PageError message={game.error} />;
  if (!game.state) return <PageLoading />;
  return <AdminGame code={code} game={game} token={access.token} />;
}

function AdminStart() {
  const createGame = useCreateGame();
  return (
    <Layout>
      <main className="single-page">
        <section className="entry-card">
          <p className="eyebrow">Пульт ведущего</p>
          <h1>Новая игра</h1>
          <p>Создайте комнату. Здесь появятся код для игроков и кнопки управления игрой.</p>
          {createGame.error && <p className="form-error">{createGame.error}</p>}
          <CreateGameForm createGame={createGame} />
        </section>
      </main>
    </Layout>
  );
}

function CreateGameForm({ createGame }: { createGame: ReturnType<typeof useCreateGame> }) {
  return (
    <form onSubmit={createGame.run}>
      <input
        aria-label="Код комнаты"
        autoCapitalize="characters"
        maxLength={12}
        onChange={(event) => createGame.setCode(event.target.value.toUpperCase())}
        pattern="[A-Za-z0-9]{4,12}"
        placeholder="Код комнаты — необязательно"
        spellCheck={false}
        value={createGame.code}
      />
      <button className="primary-button" disabled={createGame.busy} type="submit">
        {createGame.busy ? 'Создаём…' : 'Создать игру'}
      </button>
    </form>
  );
}

function useCreateGame() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const normalized = code.trim().toUpperCase();
      const result = await api.createGame(normalized ? { code: normalized } : {});
      sessionStorage.setItem(adminTokenKey(result.state.code), result.adminToken);
      navigate(`/admin/${result.state.code}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не получилось создать игру.');
      setBusy(false);
    }
  }
  return { busy, code, error, run, setCode };
}

type AdminGameProps = {
  code: string;
  game: ReturnType<typeof useGameState>;
  token: string;
};

function AdminGame({ code, game, token }: AdminGameProps) {
  const state = game.state as GameState;
  const forecast = useAdminForecast(code, token, state);
  return (
    <Layout>
      <main className="game-page">
        <GameHeader connected={game.connected} state={state} title="Пульт ведущего" />
        <MetricBoard breakdown={state.currentRound?.effectBreakdown} state={state} />
        <div className="admin-layout">
          <div>
            <GameFocus forecast={forecast.forecast} state={state} />
            {forecast.error && <p className="form-error">{forecast.error}</p>}
            <MetricChangeNotes state={state} />
            <ActivatedActions state={state} />
            <RecoveryGuides state={state} />
            <StageMap state={state} />
          </div>
          <aside>
            <AdminControls code={code} game={game} state={state} token={token} />
            <SharePanel code={code} password={token} />
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
        {countWithNoun(state.playerCount, ['игрок', 'игрока', 'игроков'])} ·{' '}
        {countWithNoun(state.voteCount, ['голос', 'голоса', 'голосов'])}
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
        ...commandChoice(state, optionId),
        expectedTransitionVersion: state.transitionVersion,
        type,
      });
      game.setState(result.state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не получилось выполнить команду.');
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
  if (!command) return <p className="muted">Игра окончена.</p>;
  return (
    <button className="primary-button" disabled={busy} onClick={() => send(command)} type="button">
      {busy ? 'Подождите…' : commandLabel(command, state)}
    </button>
  );
}

function TieButtons({ busy, send, state }: Parameters<typeof ControlButtons>[0]) {
  const leaders = tieLeaders(state);
  return (
    <div className="tie-buttons">
      <p>{tieLabel(state)}</p>
      {leaders.map((leader) => (
        <button
          disabled={busy}
          key={leader.id}
          onClick={() => send('RESOLVE_TIE', leader.id)}
          type="button"
        >
          {leader.label}
        </button>
      ))}
    </div>
  );
}

function SharePanel({ code, password }: { code: string; password: string }) {
  const playerUrl = `${window.location.origin}${window.location.pathname}#/play/${code}`;
  return (
    <section className="share-panel">
      <p className="eyebrow">Подключение</p>
      <QRCodeSVG bgColor="#ffffff" fgColor="#111214" size={164} value={playerUrl} />
      <strong>{code}</strong>
      <div className="host-password">
        <small>Пароль ведущего</small>
        <strong>{password}</strong>
      </div>
      <Link to={`/screen/${code}`}>Открыть общий экран</Link>
    </section>
  );
}

function AdminLogin({ code, onLogin }: { code: string; onLogin: (token: string) => void }) {
  const login = useAdminLogin(code, onLogin);
  return (
    <Layout>
      <main className="single-page">
        <section className="entry-card">
          <p className="eyebrow">Комната {code}</p>
          <h1>Войти в пульт</h1>
          <p>Введите пароль ведущего. Его можно взять у того, кто создал комнату.</p>
          {login.error && <p className="form-error">{login.error}</p>}
          <AdminLoginForm login={login} />
        </section>
      </main>
    </Layout>
  );
}

function AdminLoginForm({ login }: { login: ReturnType<typeof useAdminLogin> }) {
  return (
    <form onSubmit={login.run}>
      <input
        aria-label="Пароль ведущего"
        autoCapitalize="characters"
        autoComplete="current-password"
        maxLength={64}
        minLength={4}
        onChange={(event) => login.setPassword(event.target.value)}
        placeholder="XXXX-XXXX-XXXX"
        spellCheck={false}
        type="password"
        value={login.password}
      />
      <button className="primary-button" disabled={login.busy} type="submit">
        {login.busy ? 'Проверяем…' : 'Войти'}
      </button>
    </form>
  );
}

function useAdminLogin(code: string, onLogin: (token: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  async function run(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.loginAdmin(code, password);
      onLogin(result.adminToken);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не получилось войти в пульт.');
      setBusy(false);
    }
  }
  return { busy, error, password, run, setPassword };
}

function useAdminAccess(code: string | undefined) {
  const [active, setActive] = useState<{ code: string; token: string } | null>(null);
  const stored = code ? sessionStorage.getItem(adminTokenKey(code)) : null;
  const token = active && active.code === code ? active.token : stored;
  function save(next: string) {
    if (!code) return;
    sessionStorage.setItem(adminTokenKey(code), next);
    setActive({ code, token: next });
  }
  return { save, token };
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
  const kind = state.currentBallot?.kind;
  if (state.phase === 'VOTING' && kind === 'STAGE') return 'Закройте выбор этапа, когда зал готов';
  if (state.phase === 'VOTING' && kind === 'ACTION')
    return 'Закройте выбор решения, когда зал готов';
  if (state.phase === 'VOTING') return 'Закройте голосование, когда зал готов';
  if (state.phase === 'RESULT' && hasTie(state)) return tieLabel(state);
  if (state.phase === 'RESULT' && kind === 'STAGE')
    return 'Обсудите выбор, затем откройте варианты решений';
  if (state.phase === 'RESULT') return 'Обсудите решение, затем покажите событие';
  if (state.phase === 'EVENT') return 'Обсудите событие, затем примените последствия';
  if (state.phase === 'FEEDBACK') return 'Разберите изменения и открывайте следующий ход';
  return state.decisionModel === 'STAGE_ACTION_V2'
    ? 'Откройте выбор этапа'
    : 'Откройте первый раунд';
}

function commandLabel(command: AdminCommandName, state: GameState) {
  if (command === 'OPEN_VOTING' && state.decisionModel === 'STAGE_ACTION_V2')
    return 'Открыть выбор этапа';
  if (command === 'OPEN_NEXT_BALLOT') return 'Перейти к выбору решения';
  if (command === 'CLOSE_VOTING' && state.currentBallot?.kind === 'STAGE')
    return 'Закрыть выбор этапа';
  if (command === 'CLOSE_VOTING' && state.currentBallot?.kind === 'ACTION')
    return 'Закрыть выбор решения';
  return defaultCommandLabels[command];
}

function commandChoice(state: GameState, id?: string) {
  if (!id) return {};
  return state.decisionModel === 'STAGE_ACTION_V2' ? { choiceId: id } : { optionId: id };
}

function hasTie(state: GameState) {
  return state.currentBallot
    ? state.currentBallot.tiedChoiceIds.length > 0
    : Boolean(state.currentRound?.tiedOptionIds.length);
}

function tieLabel(state: GameState) {
  if (state.currentBallot?.kind === 'STAGE') return 'Ничья в выборе этапа';
  if (state.currentBallot?.kind === 'ACTION') return 'Ничья в выборе решения';
  return 'Ничья: выберите вариант с максимальным числом голосов';
}

function countWithNoun(count: number, forms: [string, string, string]) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} ${forms[0]}`;
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) {
    return `${count} ${forms[1]}`;
  }
  return `${count} ${forms[2]}`;
}

function tieLeaders(state: GameState) {
  const ballot = state.currentBallot;
  if (ballot) {
    return ballot.tiedChoiceIds.map((id) => {
      const choice = ballot.choices.find((item) => item.id === id);
      const key = choice && 'key' in choice ? `${choice.key}: ` : '';
      return { id, label: `${key}${choice?.title ?? id}` };
    });
  }
  return (state.currentRound?.tiedOptionIds ?? []).map((id) => {
    const option = state.currentRound?.options.find((item) => item.id === id);
    return { id, label: `${option?.key ?? ''}: ${option?.title ?? id}` };
  });
}

const defaultCommandLabels: Record<AdminCommandName, string> = {
  APPLY_CONSEQUENCES: 'Применить последствия',
  CLOSE_VOTING: 'Закрыть голосование',
  OPEN_NEXT_BALLOT: 'Перейти к выбору решения',
  OPEN_VOTING: 'Открыть голосование',
  RESOLVE_TIE: 'Выбрать победителя',
  SHOW_EVENT: 'Показать событие',
};
