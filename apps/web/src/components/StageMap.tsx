import { type GameState, type StageKey, stageKeys } from '@ai-sdlc/contracts';
import { stageLabels, stageStateLabels } from '../labels';

export function StageMap({ state }: { state: GameState }) {
  return (
    <section className="map-section">
      <div className="section-heading">
        <p className="eyebrow">Карта процесса</p>
        <h2>Что уже изменилось</h2>
      </div>
      <div className="stage-grid">
        {stageKeys.map((key, index) => (
          <StageCard index={index} key={key} stage={key} state={state} />
        ))}
      </div>
    </section>
  );
}

function StageCard({ index, stage, state }: { index: number; stage: StageKey; state: GameState }) {
  const stageState = state.stages[stage];
  return (
    <article className={`stage-card stage-${stageState.toLowerCase()}`}>
      <span>{String(index + 1).padStart(2, '0')}</span>
      <strong>{stageLabels[stage]}</strong>
      <small>{stageStateLabels[stageState]}</small>
    </article>
  );
}
