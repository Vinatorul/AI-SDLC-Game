import {
  type EffectContribution,
  type GameState,
  type MetricDelta,
  type MetricKey,
  metricKeys,
  type StageKey,
} from '@ai-sdlc/contracts';
import { propertyLabels, stageLabels, stageStateLabels } from '../labels';

type ChangeReason = { blocked?: boolean; description: string; effect: number; label: string };
type FallbackSource = { delta: MetricDelta; description: string; label: string };

type MetricExplanation = {
  applied: number | null;
  key: MetricKey;
  raw: number;
  reasons: ChangeReason[];
};

export function MetricChangeNotes({ state }: { state: GameState }) {
  const explanations = buildExplanations(state);
  if (explanations.length === 0) return null;
  return (
    <section className="metric-notes" aria-labelledby="metric-notes-title">
      <div className="section-heading metric-notes-heading">
        <p className="eyebrow">После хода</p>
        <h2 id="metric-notes-title">Откуда взялись баллы</h2>
      </div>
      <div className="metric-notes-grid">
        {explanations.map((item) => (
          <MetricExplanationCard explanation={item} key={item.key} state={state} />
        ))}
      </div>
    </section>
  );
}

function MetricExplanationCard({
  explanation,
  state,
}: {
  explanation: MetricExplanation;
  state: GameState;
}) {
  const definition = state.metricDefinitions[explanation.key];
  return (
    <article className="metric-note-card">
      <header>
        <h3>{definition.label}</h3>
        <strong
          className={(explanation.applied ?? explanation.raw) < 0 ? 'metric-delta-negative' : ''}
        >
          {changeLabel(explanation.applied, explanation.raw)}
        </strong>
      </header>
      <ul>
        {explanation.reasons.map((reason, index) => (
          <ReasonRow key={`${reason.label}-${index}`} reason={reason} />
        ))}
      </ul>
      {explanation.applied !== null && explanation.raw !== explanation.applied && (
        <p className="metric-limit-note">{limitNote(explanation, state)}</p>
      )}
    </article>
  );
}

function ReasonRow({ reason }: { reason: ChangeReason }) {
  return (
    <li>
      <div className="metric-reason-heading">
        <strong>{reason.label}</strong>
        <b className={!reason.blocked && reason.effect < 0 ? 'metric-delta-negative' : ''}>
          {reason.blocked ? 'не начислено' : formatSigned(reason.effect)}
        </b>
      </div>
      <p>{reason.description}</p>
    </li>
  );
}

function buildExplanations(state: GameState): MetricExplanation[] {
  const breakdown = state.currentRound?.effectBreakdown;
  if (!breakdown) return [];
  return metricKeys.flatMap((key) => {
    const reasons = reasonsForMetric(state, key);
    if (reasons.length === 0) return [];
    return [
      {
        applied: breakdown.applied?.[key] ?? null,
        key,
        raw: breakdown.total[key] ?? 0,
        reasons,
      },
    ];
  });
}

function reasonsForMetric(state: GameState, metric: MetricKey) {
  const contributions = state.currentRound?.effectContributions ?? [];
  const explicit = contributions.flatMap((item) => contributionReason(item, metric, state));
  return explicit.length > 0 ? explicit : fallbackReasons(state, metric);
}

function contributionReason(item: EffectContribution, metric: MetricKey, state: GameState) {
  return [
    ...appliedContributionReason(item, metric, state),
    ...blockedContributionReason(item, metric, state),
  ];
}

function appliedContributionReason(item: EffectContribution, metric: MetricKey, state: GameState) {
  const effect = item.effect[metric] ?? 0;
  if (effect === 0) return [];
  if (item.kind === 'DECISION') {
    const description = item.effectReasons?.[metric] ?? item.description;
    return [{ description, effect, label: `Выбрали: ${item.title}` }];
  }
  if (item.kind === 'EVENT') {
    const description = item.effectReasons?.[metric] ?? item.description;
    return [{ description, effect, label: `Событие: ${item.title}` }];
  }
  if (item.kind === 'PROPERTY') return [propertyReason(item, metric, effect, state)];
  if (item.kind === 'STAGE_STATE') return [stageReason(item, metric, effect, state)];
  return [];
}

function blockedContributionReason(
  item: EffectContribution,
  metric: MetricKey,
  state: GameState,
): ChangeReason[] {
  const effect = item.blockedEffect?.[metric] ?? 0;
  const stages = item.blockedByStages?.[metric] ?? [];
  if (effect <= 0 || stages.length === 0) return [];
  if (item.kind !== 'DECISION' && item.kind !== 'EVENT') return [];
  return [
    {
      blocked: true,
      description: blockedEffectDescription(
        stages,
        metric,
        effect,
        state,
        item.effectReasons?.[metric],
      ),
      effect,
      label: `Не засчитали: ${item.title}`,
    },
  ];
}

function blockedEffectDescription(
  stages: StageKey[],
  metric: MetricKey,
  effect: number,
  state: GameState,
  expectedReason?: string,
) {
  const names = stages.map((stage) => `«${stageLabels[stage]}»`);
  const subject = names.length === 1 ? `Сломан этап ${names[0]}` : `Сломаны этапы ${list(names)}`;
  const metricLabel = state.metricDefinitions[metric].label;
  const blocked = `${subject}, поэтому ${formatSigned(effect)} к метрике «${metricLabel}» не начислили.`;
  return expectedReason ? `${expectedReason} ${blocked}` : blocked;
}

function list(items: string[]) {
  if (items.length < 2) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} и ${items.at(-1)}`;
}

function propertyReason(
  item: Extract<EffectContribution, { kind: 'PROPERTY' }>,
  metric: MetricKey,
  effect: number,
  state: GameState,
): ChangeReason {
  const metricLabel = state.metricDefinitions[metric].label;
  return {
    description: item.effectReasons?.[metric] ?? legacyPropertyReason(effect, metricLabel),
    effect,
    label: `Практика: ${propertyLabels[item.property]}`,
  };
}

function stageReason(
  item: Extract<EffectContribution, { kind: 'STAGE_STATE' }>,
  metric: MetricKey,
  effect: number,
  state: GameState,
): ChangeReason {
  const stage = stageLabels[item.stage];
  const metricLabel = state.metricDefinitions[metric].label;
  const description =
    item.effectReasons?.[metric] ?? legacyStageReason(item, stage, metricLabel, effect);
  return { description, effect, label: `${stage}: ${stageStateLabels[item.state]}` };
}

function legacyPropertyReason(effect: number, metric: string) {
  return `Эту практику добавили раньше. В этом ходу из-за неё метрика «${metric}» ${scoreVerb(effect)} ${scoreAmount(effect)}.`;
}

function legacyStageReason(
  item: Extract<EffectContribution, { kind: 'STAGE_STATE' }>,
  stage: string,
  metric: string,
  effect: number,
) {
  const subject =
    item.state === 'BROKEN'
      ? `«${stage}» всё ещё сломан.`
      : `Этап «${stage}» остаётся в том же состоянии.`;
  return `${subject} Из-за этого метрика «${metric}» ${scoreVerb(effect)} ${scoreAmount(effect)}.`;
}

function scoreVerb(effect: number) {
  return effect > 0 ? 'выросла на' : 'снизилась на';
}

function scoreAmount(effect: number) {
  const amount = Math.abs(effect);
  const mod10 = amount % 10;
  const mod100 = amount % 100;
  const one = mod10 === 1 && mod100 !== 11;
  const few = [2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100);
  const word = one ? 'балл' : few ? 'балла' : 'баллов';
  return `${amount} ${word}`;
}

function fallbackReasons(state: GameState, metric: MetricKey) {
  const sources = [...fallbackNarrativeSources(state), ...fallbackSystemSources(state)];
  return sources.flatMap((source) => fallbackReason(source, metric));
}

function fallbackNarrativeSources(state: GameState): FallbackSource[] {
  const round = state.currentRound;
  const breakdown = round?.effectBreakdown;
  if (!round || !breakdown) return [];
  const action = round.options.find(({ id }) => id === round.selectedOptionId);
  return [
    {
      delta: breakdown.decision,
      description: action?.shortFeedback ?? action?.description ?? '',
      label: `Выбрали: ${action?.title ?? 'решение'}`,
    },
    {
      delta: breakdown.event,
      description: round.event?.description ?? '',
      label: `Событие: ${round.event?.title ?? 'этот ход прошёл без сюрпризов'}`,
    },
  ];
}

function fallbackSystemSources(state: GameState): FallbackSource[] {
  const breakdown = state.currentRound?.effectBreakdown;
  if (!breakdown) return [];
  return [
    {
      delta: breakdown.properties,
      description:
        'Эта комната создана в старой версии, поэтому здесь есть только общая сумма по всем практикам.',
      label: 'Практики из прошлых ходов',
    },
    {
      delta: breakdown.pipeline ?? {},
      description:
        'Эта комната создана в старой версии, поэтому здесь есть только общая сумма по всем этапам.',
      label: 'Этапы SDLC',
    },
  ];
}

function fallbackReason(source: FallbackSource, metric: MetricKey): ChangeReason[] {
  const effect = source.delta[metric] ?? 0;
  return effect === 0 ? [] : [{ description: source.description, effect, label: source.label }];
}

function limitNote(explanation: MetricExplanation, state: GameState) {
  const applied = explanation.applied;
  if (applied === null) return '';
  const upper = explanation.raw > applied;
  const boundary = upper ? state.metricBounds.maximum : state.metricBounds.minimum;
  return `Расчёт дал ${formatSigned(explanation.raw)}. Шкала заканчивается на ${formatSigned(boundary)}, поэтому засчитали ${formatSigned(applied)}.`;
}

function changeLabel(applied: number | null, raw: number) {
  if (applied === null) return `Расчёт: ${formatSigned(raw)}`;
  return applied === 0 ? 'Итого: без изменений' : `Итого: ${formatSigned(applied)}`;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
