import {
  type ActionBallotChoice,
  type BallotView,
  type GameState,
  type StageBallotChoice,
  type StageKey,
  stageKeys,
} from '@ai-sdlc/contracts';
import { stageLabels, stageStateLabels } from '../labels';
import { BallotProgress } from './BallotProgress';

type BallotFocusProps = {
  interactive?: boolean;
  onSelect?: (choiceId: string) => void;
  selected?: string | null;
  state: GameState;
};

export function BallotFocus(props: BallotFocusProps) {
  const ballot = props.state.currentBallot;
  if (!ballot || ballot.kind === 'LEGACY_OPTION') return null;
  return (
    <section className="round-focus ballot-focus">
      <BallotRoundContext state={props.state} />
      <BallotProgress kind={ballot.kind} stageSelected={Boolean(ballot.selectedChoiceId)} />
      {ballot.kind === 'STAGE' ? (
        <StageBallot ballot={ballot} {...props} />
      ) : (
        <ActionBallot ballot={ballot} {...props} />
      )}
    </section>
  );
}

function StageBallot({ ballot, ...props }: BallotFocusProps & { ballot: BallotView }) {
  const choices = ballot.choices.filter(isStageChoice);
  return (
    <div className="stage-grid stage-ballot-grid">
      {choices.map((choice) => (
        <StageChoiceCard choice={choice} key={choice.id} {...props} />
      ))}
    </div>
  );
}

function StageChoiceCard({ choice, ...props }: BallotFocusProps & StageChoiceCardProps) {
  const ballot = props.state.currentBallot as BallotView;
  const progress = props.state.stageProgress[choice.stage];
  const tally = ballot.voteTallies.find((item) => item.choiceId === choice.id);
  return (
    <button
      className={stageChoiceClass(choice.id, props.state, props.selected)}
      disabled={!props.interactive}
      onClick={() => props.onSelect?.(choice.id)}
      type="button"
    >
      <span>{stageNumber(choice.stage)}</span>
      <span className="stage-card-main">
        <strong>{choice.title}</strong>
        <small>{stageStateLabels[progress.state]}</small>
        <small>{choice.description}</small>
      </span>
      <StageActionSummary stage={choice.stage} state={props.state} />
      {props.state.phase === 'RESULT' && <b className="stage-votes">{tally?.count ?? 0}</b>}
    </button>
  );
}

type StageChoiceCardProps = { choice: StageBallotChoice };

function ActionBallot({ ballot, ...props }: BallotFocusProps & { ballot: BallotView }) {
  const choices = ballot.choices.filter(isActionChoice);
  const stage = ballot.stage ?? choices[0]?.stage;
  return (
    <>
      <ActionStageBanner stage={stage} state={props.state} />
      <BallotHeading
        description="Выберите конкретный способ работы для этапа. До закрытия голос можно менять."
        title={`Что делаем с этапом «${stage ? stageLabels[stage] : 'выбранный этап'}»?`}
      />
      <div className="option-grid">
        {choices.map((choice) => (
          <ActionChoiceCard choice={choice} key={choice.id} {...props} />
        ))}
      </div>
    </>
  );
}

function ActionChoiceCard({ choice, ...props }: BallotFocusProps & { choice: ActionBallotChoice }) {
  const ballot = props.state.currentBallot as BallotView;
  const tally = ballot.voteTallies.find((item) => item.choiceId === choice.id);
  return (
    <button
      className={actionChoiceClass(choice.id, props.state, props.selected)}
      disabled={!props.interactive}
      onClick={() => props.onSelect?.(choice.id)}
      type="button"
    >
      <span className="option-key">{choice.key}</span>
      <span className="option-copy">
        <small>{stageLabels[choice.stage]}</small>
        <strong>{choice.title}</strong>
        <span>{choice.description}</span>
        {choice.shortFeedback && props.state.phase === 'RESULT' && <em>{choice.shortFeedback}</em>}
      </span>
      {props.state.phase === 'RESULT' && <b className="option-votes">{tally?.count ?? 0}</b>}
    </button>
  );
}

function BallotHeading({ description, title }: { description: string; title: string }) {
  return (
    <div className="round-question">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function BallotRoundContext({ state }: { state: GameState }) {
  const round = state.currentRound;
  if (!round) return null;
  return (
    <div className="ballot-round-context">
      <p className="eyebrow">Ход {round.number}</p>
      <h2>{round.title}</h2>
      <p>{round.situation}</p>
    </div>
  );
}

function ActionStageBanner({ stage, state }: { stage?: StageKey; state: GameState }) {
  if (!stage) return null;
  const progress = state.stageProgress[stage];
  return (
    <div className="action-stage-banner">
      <span>Выбранный этап</span>
      <strong>{stageLabels[stage]}</strong>
      <small>{stageStateLabels[progress.state]}</small>
    </div>
  );
}

function StageActionSummary({ stage, state }: { stage: StageKey; state: GameState }) {
  const actions = state.stageProgress[stage].appliedActions;
  if (actions.length === 0) return null;
  return (
    <span className="stage-actions">
      <small>Применено действий: {actions.length}</small>
      {actions.slice(-2).map((action) => (
        <b key={`${action.roundNumber}:${action.actionId}`}>{action.title}</b>
      ))}
    </span>
  );
}

function stageChoiceClass(id: string, state: GameState, selected?: string | null) {
  return choiceClass('stage-card', id, state, selected);
}

function actionChoiceClass(id: string, state: GameState, selected?: string | null) {
  return choiceClass('option-card', id, state, selected);
}

function choiceClass(base: string, id: string, state: GameState, selected?: string | null) {
  const ballot = state.currentBallot;
  const classes = [base, `stage-${choiceStage(id, state).toLowerCase()}`];
  if (selected === id) classes.push('is-selected');
  if (ballot?.selectedChoiceId === id) classes.push('is-winner');
  if (ballot?.tiedChoiceIds.includes(id)) classes.push('is-tied');
  return classes.join(' ');
}

function choiceStage(id: string, state: GameState) {
  const choice = state.currentBallot?.choices.find((item) => item.id === id);
  return choice ? state.stageProgress[choice.stage].state : 'AS_IS';
}

function stageNumber(stage: StageKey) {
  return String(stageKeys.indexOf(stage) + 1).padStart(2, '0');
}

function isStageChoice(choice: BallotView['choices'][number]): choice is StageBallotChoice {
  return choice.kind === 'STAGE';
}

function isActionChoice(choice: BallotView['choices'][number]): choice is ActionBallotChoice {
  return choice.kind === 'ACTION';
}
