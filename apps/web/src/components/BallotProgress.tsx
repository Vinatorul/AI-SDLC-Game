import type { BallotKind } from '@ai-sdlc/contracts';

export function BallotProgress({ kind, stageSelected }: BallotProgressProps) {
  if (kind === 'LEGACY_OPTION') return null;
  const actionStep = kind === 'ACTION';
  const stageComplete = actionStep || stageSelected;
  return (
    <div className="ballot-progress">
      <span className={`ballot-step ${stageComplete ? 'is-complete' : 'is-active'}`}>
        1. Выбираем этап
      </span>
      <i aria-hidden="true">→</i>
      <span className={`ballot-step ${actionStep ? 'is-active' : ''}`}>2. Выбираем способ</span>
    </div>
  );
}

type BallotProgressProps = { kind: BallotKind; stageSelected: boolean };
