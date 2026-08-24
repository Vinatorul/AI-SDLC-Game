import type { RoundView } from '@ai-sdlc/contracts';
import { stageLabels } from '../labels';

type OptionGridProps = {
  disabled?: boolean;
  onSelect?: (optionId: string) => void;
  round: RoundView;
  selected?: string | null;
  showResults?: boolean;
};

export function OptionGrid(props: OptionGridProps) {
  return (
    <div className="option-grid">
      {props.round.options.map((option) => {
        const tally = props.round.voteTallies.find((item) => item.optionId === option.id);
        return (
          <button
            className={optionClass(option.id, props)}
            disabled={props.disabled}
            key={option.id}
            onClick={() => props.onSelect?.(option.id)}
            type="button"
          >
            <span className="option-key">{option.key}</span>
            <span className="option-copy">
              <small>{stageLabels[option.stage]}</small>
              <strong>{option.title}</strong>
              <span>{option.description}</span>
            </span>
            {props.showResults && <b className="option-votes">{tally?.count ?? 0}</b>}
          </button>
        );
      })}
    </div>
  );
}

function optionClass(optionId: string, props: OptionGridProps) {
  const classes = ['option-card'];
  if (props.selected === optionId) classes.push('is-selected');
  if (props.round.selectedOptionId === optionId) classes.push('is-winner');
  if (props.round.tiedOptionIds.includes(optionId)) classes.push('is-tied');
  return classes.join(' ');
}
