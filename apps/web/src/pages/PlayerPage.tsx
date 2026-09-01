import type { GameState, VoteRequest } from '@ai-sdlc/contracts';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { playerTokenKey } from '../api/storage';
import { BallotFocus } from '../components/BallotFocus';
import { CodeEntry } from '../components/CodeEntry';
import { EventCard, FinalState } from '../components/GameFocus';
import { Layout } from '../components/Layout';
import { MetricBoard } from '../components/MetricBoard';
import { OptionGrid } from '../components/OptionGrid';
import { AppliedHistory } from '../components/StageMap';
import { useGameState } from '../realtime/useGameState';

export function PlayerPage() {
  const navigate = useNavigate();
  const { code } = useParams();
  const [joinedSession, setJoinedSession] = useState<PlayerSession | null>(null);
  const token = playerToken(code, joinedSession);
  const game = useGameState(code, token ?? undefined);
  if (!code) return <PlayerCodeEntry onSubmit={(value) => navigate(`/play/${value}`)} />;
  if (!token) {
    return (
      <JoinForm
        code={code}
        game={game}
        onJoined={(nextToken) => setJoinedSession({ code, token: nextToken })}
      />
    );
  }
  if (game.error) return <PlayerError message={game.error} />;
  if (!game.state) return <PlayerLoading />;
  return <PlayerGame code={code} game={game} state={game.state} token={token} />;
}

function PlayerCodeEntry({ onSubmit }: { onSubmit: (code: string) => void }) {
  return (
    <Layout>
      <main className="single-page">
        <CodeEntry
          action="Войти"
          description="Код покажет ведущий или общий экран."
          onSubmit={onSubmit}
          title="Войти в игру"
        />
      </main>
    </Layout>
  );
}

type PlayerSession = { code: string; token: string };

function playerToken(code: string | undefined, joinedSession: PlayerSession | null) {
  if (!code) return null;
  if (joinedSession?.code === code) return joinedSession.token;
  return localStorage.getItem(playerTokenKey(code));
}

type JoinFormProps = {
  code: string;
  game: ReturnType<typeof useGameState>;
  onJoined: (token: string) => void;
};

function JoinForm({ code, game, onJoined }: JoinFormProps) {
  const join = useJoinGame(code, game, onJoined);
  return (
    <Layout>
      <main className="single-page">
        <JoinCard code={code} join={join} />
      </main>
    </Layout>
  );
}

function useJoinGame(
  code: string,
  game: ReturnType<typeof useGameState>,
  onJoined: (token: string) => void,
) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.join(code, name.trim());
      localStorage.setItem(playerTokenKey(code), result.playerToken);
      onJoined(result.playerToken);
      game.setState(result.state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не получилось войти в комнату.');
      setBusy(false);
    }
  }
  return { busy, error, name, setName, submit };
}

function JoinCard({ code, join }: { code: string; join: ReturnType<typeof useJoinGame> }) {
  return (
    <section className="entry-card">
      <p className="eyebrow">Комната {code}</p>
      <h1>Как вас подписать?</h1>
      <form onSubmit={join.submit}>
        <input
          aria-label="Имя"
          maxLength={40}
          onChange={(event) => join.setName(event.target.value)}
          placeholder="Имя"
          required
          value={join.name}
        />
        <button className="primary-button" disabled={join.busy} type="submit">
          {join.busy ? 'Входим…' : 'Присоединиться'}
        </button>
      </form>
      {join.error && <p className="form-error">{join.error}</p>}
    </section>
  );
}

type PlayerGameProps = {
  code: string;
  game: ReturnType<typeof useGameState>;
  state: GameState;
  token: string;
};

function PlayerGame({ code, game, state, token }: PlayerGameProps) {
  const vote = usePlayerVote(code, game, token);
  return <PlayerGameView error={vote.error} onVote={vote.submit} state={state} />;
}

export function PlayerGameView({ error, onVote, state }: PlayerDecisionProps) {
  return (
    <Layout bare>
      <main className="game-page player-page">
        <PlayerDecision error={error} onVote={onVote} state={state} />
        <AppliedHistory state={state} />
      </main>
    </Layout>
  );
}

function usePlayerVote(code: string, game: PlayerGameProps['game'], token: string) {
  const [error, setError] = useState<string | null>(null);
  async function submit(vote: VoteRequest) {
    try {
      const result = await api.vote(code, token, vote);
      game.setState(result.state);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не получилось сохранить голос.');
      await game.refresh();
    }
  }
  return { error, submit };
}

export function PlayerDecision({ error, onVote, state }: PlayerDecisionProps) {
  if (state.phase === 'WON' || state.phase === 'BROKEN') return <FinalState state={state} />;
  if (state.phase === 'EVENT' || state.phase === 'FEEDBACK') {
    return <PlayerRoundResult state={state} />;
  }
  if (state.phase === 'RESULT') return <PlayerVoteResult state={state} />;
  if (state.phase !== 'VOTING') return <PlayerWaiting state={state} />;
  const ballot = state.currentBallot;
  if (state.decisionModel === 'STAGE_ACTION_V2') {
    if (!ballot || ballot.kind === 'LEGACY_OPTION') return <PlayerVotingLoading />;
    return <PlayerBallotVote error={error} onVote={onVote} state={state} />;
  }
  return <PlayerLegacyVote error={error} onVote={onVote} state={state} />;
}

type PlayerDecisionProps = {
  error: string | null;
  onVote: (vote: VoteRequest) => void;
  state: GameState;
};

function PlayerWaiting({ state }: { state: GameState }) {
  return (
    <>
      <section aria-live="polite" className="player-waiting">
        <p className="eyebrow">Голосование не идёт</p>
        <p>Ждём, когда ведущий откроет голосование.</p>
      </section>
      <MetricBoard compact state={state} />
    </>
  );
}

function PlayerRoundResult({ state }: { state: GameState }) {
  if (!state.currentRound?.event) return <PlayerWaiting state={state} />;
  return (
    <>
      <section className="round-focus player-result">
        <EventCard state={state} />
      </section>
      {state.phase === 'FEEDBACK' && (
        <MetricBoard compact breakdown={state.currentRound.effectBreakdown} state={state} />
      )}
    </>
  );
}

function PlayerVoteResult({ state }: { state: GameState }) {
  const ballot = state.currentBallot;
  if (!ballot) return <PlayerWaiting state={state} />;
  if (ballot.kind === 'LEGACY_OPTION') return <PlayerLegacyResult state={state} />;
  const tied = !ballot.selectedChoiceId && ballot.tiedChoiceIds.length > 0;
  return (
    <div aria-live="polite" className="player-ballot-result">
      <BallotFocus state={state} variant="player" />
      {tied && <p className="player-result-note">Ничья. Ведущий выберет один из лидеров.</p>}
    </div>
  );
}

function PlayerLegacyResult({ state }: { state: GameState }) {
  const round = state.currentRound;
  if (!round) return <PlayerWaiting state={state} />;
  return (
    <section className="round-focus">
      <OptionGrid disabled round={round} showResults />
    </section>
  );
}

function PlayerBallotVote({ error, onVote, state }: PlayerDecisionProps) {
  const ballot = state.currentBallot;
  if (!ballot) return <PlayerVotingLoading />;
  return (
    <>
      <BallotFocus
        interactive
        onSelect={(choiceId) => onVote({ ballotId: ballot.id, choiceId })}
        selected={state.myVoteChoiceId}
        state={state}
        variant="player"
      />
      {state.myVoteChoiceId && ballot.kind !== 'LEGACY_OPTION' && (
        <VoteConfirmation kind={ballot.kind} />
      )}
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

function PlayerLegacyVote({ error, state, onVote }: PlayerDecisionProps) {
  const round = state.currentRound;
  if (!round) return <PlayerVotingLoading />;
  return (
    <section className="round-focus">
      <div className="round-question">
        <p className="eyebrow">Раунд {round.number}</p>
        <h2>{round.title}</h2>
        <p>{round.situation}</p>
      </div>
      <OptionGrid
        onSelect={(optionId) => onVote({ optionId })}
        round={round}
        selected={state.myVoteOptionId}
      />
      {state.myVoteOptionId && (
        <p className="vote-confirmation">Голос принят. До закрытия можно выбрать другой вариант.</p>
      )}
      {error && <p className="form-error">{error}</p>}
    </section>
  );
}

function PlayerVotingLoading() {
  return (
    <section aria-live="polite" className="player-waiting">
      <p className="eyebrow">Идёт голосование</p>
      <p>Загружаем варианты…</p>
    </section>
  );
}

function VoteConfirmation({ kind }: { kind: 'STAGE' | 'ACTION' }) {
  return (
    <p className="vote-confirmation">
      {kind === 'STAGE' ? 'Голос за этап принят.' : 'Голос за решение принят.'} До закрытия можно
      выбрать другой вариант.
    </p>
  );
}

function PlayerLoading() {
  return (
    <Layout>
      <main className="single-page">
        <p>Загружаем игру…</p>
      </main>
    </Layout>
  );
}

function PlayerError({ message }: { message: string }) {
  return (
    <Layout>
      <main className="single-page">
        <p className="form-error">{message}</p>
      </main>
    </Layout>
  );
}
