import type {
  GameState,
  RecoveryActionView,
  RecoveryGuideView,
  ScenarioPresentation,
} from '@ai-sdlc/contracts';
import { presentationFor, stageLabel } from '../presentation';

export function RecoveryGuides({ state }: { state: GameState }) {
  const round = state.currentRound;
  const guides = [
    round?.recovery,
    ...(round?.blockedActivations ?? []).map(({ recovery }) => recovery),
  ].filter((guide): guide is RecoveryGuideView => Boolean(guide));
  if (guides.length === 0) return null;
  return (
    <section className="applied-history" aria-labelledby="recovery-guides-title">
      <p className="eyebrow">Подсказка ведущему</p>
      <h2 id="recovery-guides-title">Что сделать дальше</h2>
      {guides.map((guide, index) => (
        <RecoveryGuide
          guide={guide}
          key={`${guide.hostHint}:${index}`}
          presentation={presentationFor(state)}
        />
      ))}
    </section>
  );
}

type RecoveryGuideProps = {
  guide: RecoveryGuideView;
  presentation: ScenarioPresentation;
};

function RecoveryGuide({ guide, presentation }: RecoveryGuideProps) {
  const hasPrerequisites = guide.prerequisiteActions.length > 0;
  const hasRepairs = guide.repairActions.length > 0;
  const repairsSeveralStages = new Set(guide.repairActions.map(({ stage }) => stage)).size > 1;
  const repairLabel = `${hasPrerequisites ? 'Затем почините' : 'Почините'} ${repairsSeveralStages ? 'этапы' : 'этап'}`;
  return (
    <div className="recovery-guide">
      <p>{guide.hostHint}</p>
      {hasPrerequisites && (
        <RecoveryActionList
          presentation={presentation}
          actions={guide.prerequisiteActions}
          label={hasRepairs ? 'Сначала подготовьте' : 'Подготовьте'}
        />
      )}
      {hasRepairs && (
        <RecoveryActionList
          actions={guide.repairActions}
          label={repairLabel}
          presentation={presentation}
        />
      )}
    </div>
  );
}

function RecoveryActionList({
  actions,
  label,
  presentation,
}: {
  actions: RecoveryActionView[];
  label: string;
  presentation: ScenarioPresentation;
}) {
  return (
    <div className="recovery-actions">
      <h3>{label}</h3>
      <ul className="applied-history-list">
        {actions.map((action) => (
          <li key={action.actionId}>
            <span>{stageLabel(presentation, action.stage)}</span>
            <strong>{action.title}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
