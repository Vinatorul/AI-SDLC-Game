import type { GameState } from '@ai-sdlc/contracts';
import { phaseLabels } from '../labels';

type GameHeaderProps = {
  connected: boolean;
  state: GameState;
  title?: string;
};

export function GameHeader({ connected, state, title }: GameHeaderProps) {
  return (
    <header className="game-header">
      <div>
        <p className="eyebrow">{title ?? `Комната ${state.code}`}</p>
        <h1>{phaseLabels[state.phase]}</h1>
      </div>
      <div className="game-meta">
        <span className={connected ? 'connection is-online' : 'connection'}>
          {connected ? 'В сети' : 'Переподключение'}
        </span>
        <strong>{state.code}</strong>
        <span>
          Раунд {Math.min(state.roundIndex + 1, state.rules.roundLimit)}/{state.rules.roundLimit}
        </span>
      </div>
    </header>
  );
}
