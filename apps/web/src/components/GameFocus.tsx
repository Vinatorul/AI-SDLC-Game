import type { AdminForecast, GameState } from '@ai-sdlc/contracts';
import { outcomeLabels, propertyLabels } from '../labels';
import { BallotFocus } from './BallotFocus';
import { OptionGrid } from './OptionGrid';

type GameFocusProps = {
  forecast?: AdminForecast | null;
  selectedChoiceId?: string | null;
  state: GameState;
};

export function GameFocus({ forecast, selectedChoiceId, state }: GameFocusProps) {
  if (state.phase === 'WON' || state.phase === 'BROKEN') return <FinalState state={state} />;
  if (showCurrentBallot(state)) {
    return <BallotFocus forecast={forecast} selected={selectedChoiceId} state={state} />;
  }
  const round = state.currentRound;
  if (!round) return null;
  return (
    <section className="round-focus">
      <div className="round-question">
        <p className="eyebrow">
          {state.decisionModel === 'STAGE_ACTION_V2' ? 'Ход' : 'Раунд'} {round.number}
        </p>
        <h2>{round.title}</h2>
        <p>{round.situation}</p>
      </div>
      {round.event && <EventCard state={state} />}
      {!round.event && <OptionGrid disabled round={round} showResults={state.phase !== 'LOBBY'} />}
      <PropertyList state={state} />
    </section>
  );
}

function showCurrentBallot(state: GameState) {
  return (
    state.decisionModel === 'STAGE_ACTION_V2' &&
    Boolean(state.currentBallot) &&
    (state.phase === 'VOTING' || state.phase === 'RESULT')
  );
}

export function EventCard({ state }: { state: GameState }) {
  const event = state.currentRound?.event;
  if (!event) return null;
  const impact = state.currentRound?.metricImpact ?? 'NEUTRAL';
  return (
    <article className={`event-card event-${impact.toLowerCase()}`}>
      <h3>{event.title}</h3>
      <p>{event.description}</p>
    </article>
  );
}

function PropertyList({ state }: { state: GameState }) {
  if (state.properties.length === 0) return null;
  return (
    <div className="property-list">
      <span>Что команда уже подготовила</span>
      {state.properties.map((property) => (
        <strong key={property}>{propertyLabels[property]}</strong>
      ))}
    </div>
  );
}

export function FinalState({ state }: { state: GameState }) {
  const won = state.phase === 'WON';
  return (
    <section className={won ? 'final-state final-won' : 'final-state final-broken'}>
      <p className="eyebrow">Финал</p>
      <h2>{won ? 'Победа' : 'Игра окончена'}</h2>
      <p>{state.outcomeReason ? outcomeLabels[state.outcomeReason] : victoryText(state)}</p>
    </section>
  );
}

function victoryText(state: GameState) {
  if (state.rules.minAiStagesToWin === 8) {
    return 'AI работает на всех восьми этапах. Ни одна метрика не упала до критического уровня.';
  }
  const count = state.rules.minAiStagesToWin;
  return `AI работает минимум на ${count} ${stageLocationWord(count)}. Ни одна метрика не упала до критического уровня.`;
}

function stageLocationWord(count: number) {
  return count % 10 === 1 && count % 100 !== 11 ? 'этапе' : 'этапах';
}
