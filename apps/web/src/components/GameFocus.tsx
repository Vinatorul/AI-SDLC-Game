import type { GameState } from '@ai-sdlc/contracts';
import { outcomeLabels, propertyLabels } from '../labels';
import { BallotFocus } from './BallotFocus';
import { OptionGrid } from './OptionGrid';

type GameFocusProps = { selectedChoiceId?: string | null; state: GameState };

export function GameFocus({ selectedChoiceId, state }: GameFocusProps) {
  if (state.phase === 'WON' || state.phase === 'BROKEN') return <FinalState state={state} />;
  if (showCurrentBallot(state)) return <BallotFocus selected={selectedChoiceId} state={state} />;
  const round = state.currentRound;
  if (!round) return null;
  return (
    <section className="round-focus">
      <div className="round-question">
        <p className="eyebrow">Раунд {round.number}</p>
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

function EventCard({ state }: { state: GameState }) {
  const event = state.currentRound?.event;
  if (!event) return null;
  return (
    <article className="event-card">
      <span>Игровой сценарий</span>
      <h3>{event.title}</h3>
      <p>{event.description}</p>
      {state.phase === 'EVENT' && <small>Последствия ещё не применены</small>}
    </article>
  );
}

function PropertyList({ state }: { state: GameState }) {
  if (state.properties.length === 0) return null;
  return (
    <div className="property-list">
      <span>Свойства процесса</span>
      {state.properties.map((property) => (
        <strong key={property}>{propertyLabels[property]}</strong>
      ))}
    </div>
  );
}

function FinalState({ state }: { state: GameState }) {
  const won = state.phase === 'WON';
  return (
    <section className={won ? 'final-state final-won' : 'final-state final-broken'}>
      <p className="eyebrow">Финал</p>
      <h2>{won ? 'SDLC выдержал перестройку' : 'Процесс не выдержал'}</h2>
      <p>
        {state.outcomeReason
          ? outcomeLabels[state.outcomeReason]
          : 'AI встроен в несколько этапов, критических показателей нет.'}
      </p>
    </section>
  );
}
