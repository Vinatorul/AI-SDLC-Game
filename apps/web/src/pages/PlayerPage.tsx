import type { GameState, VoteRequest } from '@ai-sdlc/contracts';
import { type FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { playerTokenKey } from '../api/storage';
import { BallotFocus } from '../components/BallotFocus';
import { CodeEntry } from '../components/CodeEntry';
import { GameFocus } from '../components/GameFocus';
import { GameHeader } from '../components/GameHeader';
import { Layout } from '../components/Layout';
import { MetricBoard } from '../components/MetricBoard';
import { OptionGrid } from '../components/OptionGrid';
import { StageMap } from '../components/StageMap';
import { useGameState } from '../realtime/useGameState';

export function PlayerPage() {
  const navigate = useNavigate();
  const { code } = useParams();
  const token = code ? localStorage.getItem(playerTokenKey(code)) : null;
  const game = useGameState(code, token ?? undefined);
  if (!code) {
    return (
      <Layout>
        <main className="single-page">
          <CodeEntry
            action="Войти"
            description="Код покажет ведущий или общий экран."
            onSubmit={(value) => navigate(`/play/${value}`)}
            title="Войти в игру"
          />
        </main>
      </Layout>
    );
  }
  if (!token) return <JoinForm code={code} game={game} />;
  if (game.error) return <PlayerError message={game.error} />;
  if (!game.state) return <PlayerLoading />;
  return <PlayerGame code={code} game={game} state={game.state} token={token} />;
}

function JoinForm({ code, game }: { code: string; game: ReturnType<typeof useGameState> }) {
  const join = useJoinGame(code, game);
  return (
    <Layout>
      <main className="single-page">
        <JoinCard code={code} join={join} />
      </main>
    </Layout>
  );
}

function useJoinGame(code: string, game: ReturnType<typeof useGameState>) {
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
      game.setState(result.state);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось войти');
      setBusy(false);
    }
  }
  return { busy, error, name, setName, submit };
}

function JoinCard({ code, join }: { code: string; join: ReturnType<typeof useJoinGame> }) {
  return (
    <section className="entry-card">
      <p className="eyebrow">Комната {code}</p>
      <h1>Как вас показать ведущему?</h1>
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
  return (
    <Layout compact>
      <main className="game-page player-page">
        <GameHeader connected={game.connected} state={state} />
        <PlayerDecision error={vote.error} onVote={vote.submit} state={state} />
        <MetricBoard breakdown={state.currentRound?.effectBreakdown} state={state} />
        <StageMap state={state} />
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
      setError(caught instanceof Error ? caught.message : 'Голос не принят');
      await game.refresh();
    }
  }
  return { error, submit };
}

function PlayerDecision({ error, onVote, state }: PlayerDecisionProps) {
  if (state.phase !== 'VOTING') {
    return <GameFocus selectedChoiceId={state.myVoteChoiceId} state={state} />;
  }
  const ballot = state.currentBallot;
  if (state.decisionModel === 'STAGE_ACTION_V2' && ballot && ballot.kind !== 'LEGACY_OPTION') {
    return <PlayerBallotVote error={error} onVote={onVote} state={state} />;
  }
  return <PlayerLegacyVote error={error} onVote={onVote} state={state} />;
}

type PlayerDecisionProps = {
  error: string | null;
  onVote: (vote: VoteRequest) => void;
  state: GameState;
};

function PlayerBallotVote({ error, onVote, state }: PlayerDecisionProps) {
  const ballot = state.currentBallot;
  if (!ballot) return <GameFocus state={state} />;
  return (
    <>
      <BallotFocus
        interactive
        onSelect={(choiceId) => onVote({ ballotId: ballot.id, choiceId })}
        selected={state.myVoteChoiceId}
        state={state}
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
  if (!round) return null;
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

function VoteConfirmation({ kind }: { kind: 'STAGE' | 'ACTION' }) {
  return (
    <p className="vote-confirmation">
      {kind === 'STAGE' ? 'Голос за этап принят.' : 'Голос за способ принят.'} До закрытия можно
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
