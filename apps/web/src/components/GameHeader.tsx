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
        <h1>{stateTitle(state)}</h1>
      </div>
      <div className="game-meta">
        <span className={connected ? 'connection is-online' : 'connection'}>
          {connected ? 'В сети' : 'Переподключение'}
        </span>
        <strong>{state.code}</strong>
        <span>{roundLabel(state)}</span>
      </div>
    </header>
  );
}

function roundLabel(state: GameState) {
  const current = state.roundIndex + 1;
  if (state.rules.roundMode === 'CYCLIC') return `Ход ${current}`;
  return `Раунд ${Math.min(current, state.rules.roundLimit)}/${state.rules.roundLimit}`;
}

function stateTitle(state: GameState) {
  const ballot = state.currentBallot;
  if (
    state.decisionModel !== 'STAGE_ACTION_V2' ||
    !ballot ||
    !['VOTING', 'RESULT'].includes(state.phase)
  ) {
    return phaseLabels[state.phase];
  }
  if (state.phase === 'RESULT' && ballot.tiedChoiceIds.length > 0) {
    return ballot.kind === 'STAGE' ? 'Ничья в выборе этапа' : 'Ничья в выборе способа';
  }
  if (ballot.kind === 'STAGE') {
    return state.phase === 'VOTING' ? 'Выбор этапа' : 'Этап выбран';
  }
  if (ballot.kind === 'ACTION') {
    return state.phase === 'VOTING' ? 'Выбор способа' : 'Способ выбран';
  }
  return phaseLabels[state.phase];
}
