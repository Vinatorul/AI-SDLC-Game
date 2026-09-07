import type {
  ActionPotentialView,
  AdminForecast,
  EventBranchView,
  ForecastInfluence,
  ForecastPredicateView,
  GameState,
  MetricPotentialRange,
  StageKey,
  StageState,
} from '@ai-sdlc/contracts';
import { metricLabel, presentationFor, propertyLabel, stageLabel } from '../presentation';

type PotentialProps = { forecast?: AdminForecast | null; state: GameState };

export function StagePotential({ forecast, stage, state }: PotentialProps & { stage: StageKey }) {
  const potential = forecast?.stagePotentials.find((item) => item.stage === stage);
  if (!potential) return null;
  const metrics = presentationFor(state).metricOrder.filter((key) =>
    isChangedRange(potential.metricRanges[key]),
  );
  return (
    <span className="admin-potential">
      <small>Диапазон вариантов</small>
      <span className="potential-chips">
        {metrics.length === 0 && <span>Метрики без изменений</span>}
        {metrics.map((key) => (
          <span className={rangeClass(potential.metricRanges[key])} key={key}>
            {metricLabel(state, key)} {formatRange(potential.metricRanges[key])}
          </span>
        ))}
      </span>
      <StageOutcomes outcomes={potential.stageChanges} state={state} />
    </span>
  );
}

export function ActionPotential({
  actionId,
  forecast,
  state,
}: PotentialProps & { actionId: string }) {
  const potential = forecast?.actionPotentials.find((item) => item.actionId === actionId);
  if (!potential) return null;
  const metrics = presentationFor(state).metricOrder.filter(
    (key) => (potential.metricDelta[key] ?? 0) !== 0,
  );
  return (
    <div className="admin-potential">
      <small>Если выберут сейчас</small>
      <span className="potential-chips">
        {metrics.length === 0 && <span>Метрики без изменений</span>}
        {metrics.map((key) => (
          <span className={valueClass(potential.metricDelta[key] ?? 0)} key={key}>
            {metricLabel(state, key)} {formatSigned(potential.metricDelta[key] ?? 0)}
          </span>
        ))}
      </span>
      <StageOutcomes
        state={state}
        outcomes={potential.stageChanges.map((change) => ({ ...change, states: [change.state] }))}
      />
      <ActionConditions potential={potential} state={state} />
    </div>
  );
}

function ActionConditions({
  potential,
  state,
}: {
  potential: ActionPotentialView;
  state: GameState;
}) {
  const branches = potential.eventBranches ?? [];
  const helpful =
    (potential.activationRequirements?.length ?? 0) +
    (potential.positiveEffectRequirements?.length ?? 0);
  if (helpful === 0 && branches.length === 0) return null;
  const selectedRisk = branches.some(
    ({ influence, selected }) => selected && (influence === 'WORSENS' || influence === 'MIXED'),
  );
  return (
    <details className="forecast-conditions" open={selectedRisk}>
      <summary>{conditionsSummary(potential, branches)}</summary>
      <div className="forecast-condition-groups">
        <HelpfulConditions potential={potential} state={state} />
        <EventBranchGroups branches={branches} state={state} />
      </div>
    </details>
  );
}

type HelpfulConditionsProps = { potential: ActionPotentialView; state: GameState };

function HelpfulConditions({ potential, state }: HelpfulConditionsProps) {
  return (
    <>
      <ActivationConditions potential={potential} state={state} />
      <PositiveEffectConditions potential={potential} state={state} />
    </>
  );
}

function ActivationConditions({ potential, state }: HelpfulConditionsProps) {
  const activationRequirements = potential.activationRequirements ?? [];
  if (activationRequirements.length === 0) return null;
  return (
    <section className="condition-group influence-positive">
      <h4>{presentationFor(state).copy.activationRequirementsTitle}</h4>
      <ul>
        {activationRequirements.map((item) => (
          <ConditionRow
            key={`activation:${item.actionId}`}
            satisfied={item.satisfied}
            title={item.title}
          />
        ))}
      </ul>
    </section>
  );
}

function PositiveEffectConditions({ potential, state }: HelpfulConditionsProps) {
  const positiveEffectRequirements = potential.positiveEffectRequirements ?? [];
  if (positiveEffectRequirements.length === 0) return null;
  return (
    <section className="condition-group influence-positive">
      <h4>Что нужно для роста метрик</h4>
      <ul>
        {positiveEffectRequirements.map((item) => (
          <ConditionRow
            key={`effect:${item.metric}:${item.stage}`}
            satisfied={item.satisfied}
            title={`${metricLabel(state, item.metric)}: этап «${stageLabel(presentationFor(state), item.stage)}» работает`}
          />
        ))}
      </ul>
    </section>
  );
}

function BranchGroup({ branches, influence, state, title }: BranchGroupProps) {
  const relevant = branches.filter((branch) => branch.influence === influence);
  if (relevant.length === 0) return null;
  return (
    <section className={`condition-group influence-${influence.toLowerCase()}`}>
      <h4>{title}</h4>
      {relevant.map((branch) => (
        <EventBranch branch={branch} key={branch.eventId} state={state} />
      ))}
    </section>
  );
}

type BranchGroupProps = {
  branches: EventBranchView[];
  influence: ForecastInfluence;
  state: GameState;
  title: string;
};

function EventBranchGroups({ branches, state }: Pick<BranchGroupProps, 'branches' | 'state'>) {
  const groups: { influence: ForecastInfluence; title: string }[] = [
    { influence: 'IMPROVES', title: 'Может улучшить' },
    { influence: 'WORSENS', title: 'Может ухудшить' },
    { influence: 'MIXED', title: 'Смешанный результат' },
    { influence: 'NEUTRAL', title: 'Без изменения баллов' },
  ];
  return groups.map((group) => (
    <BranchGroup branches={branches} key={group.influence} state={state} {...group} />
  ));
}

function EventBranch({ branch, state }: { branch: EventBranchView; state: GameState }) {
  const status = branch.selected
    ? 'Сработает сейчас'
    : branch.matched
      ? 'Условия выполнены'
      : 'Условия не выполнены';
  return (
    <article className={`event-branch ${branch.selected ? 'is-selected' : ''}`}>
      <header>
        <strong>{branch.title}</strong>
        <b>{status}</b>
      </header>
      <ul>
        {branch.conditions.map((condition, index) => (
          <ConditionRow
            key={`${branch.eventId}:${index}`}
            satisfied={condition.satisfied}
            status={conditionStatus(condition)}
            title={predicateTitle(condition, state)}
          />
        ))}
      </ul>
    </article>
  );
}

function ConditionRow({ satisfied, status, title }: ConditionRowProps) {
  return (
    <li className={satisfied ? 'is-active' : 'is-inactive'}>
      <span>{title}</span>
      <b>{status ?? (satisfied ? 'Выполнено' : 'Не выполнено')}</b>
    </li>
  );
}

type ConditionRowProps = { satisfied: boolean; status?: string; title: string };

function conditionsSummary(potential: ActionPotentialView, branches: EventBranchView[]) {
  const activationRequirements = potential.activationRequirements ?? [];
  const positiveEffectRequirements = potential.positiveEffectRequirements ?? [];
  const ready = [...activationRequirements, ...positiveEffectRequirements].filter(
    ({ satisfied }) => satisfied,
  ).length;
  const total = activationRequirements.length + positiveEffectRequirements.length;
  const risks = branches.filter(
    ({ influence, selected }) => selected && (influence === 'WORSENS' || influence === 'MIXED'),
  ).length;
  const preparation = total > 0 ? `готово ${ready} из ${total}` : 'подготовка не нужна';
  return `Условия: ${preparation} · активных рисков ${risks}`;
}

function predicateTitle(condition: ForecastPredicateView, state: GameState): string {
  if (condition.kind === 'ACTION_HISTORY') {
    const prefix =
      condition.expected === 'APPLIED'
        ? 'Команда уже применила все решения из списка'
        : 'Команда ещё не применяла ни одного решения из списка';
    return `${prefix}: ${condition.titles.join('; ')}`;
  }
  if (condition.kind === 'PROPERTY') {
    const timing = condition.timing === 'BEFORE_ACTION' ? 'Сейчас' : 'После этого выбора';
    const presence =
      condition.expected === 'PRESENT'
        ? 'есть'
        : condition.timing === 'BEFORE_ACTION'
          ? 'нет'
          : 'не будет';
    return `${timing} ${presence}: ${propertyLabel(presentationFor(state), condition.property)}`;
  }
  if (condition.kind === 'STAGE_STATE') {
    return `Этап «${stageLabel(presentationFor(state), condition.stage)}»: ${presentationFor(state).stageStateLabels[condition.expected]}`;
  }
  return countTitle(condition, state);
}

function countTitle(
  condition: Extract<ForecastPredicateView, { kind: 'COUNT' }>,
  state: GameState,
) {
  const { scope } = condition;
  const repetitions =
    scope.kind === 'ACTIONS' || (scope.kind === 'STAGE_SINCE_LAST' && scope.titles !== undefined);
  const range = countRange(condition.minimum, condition.maximum, repetitions);
  if (scope.kind === 'ALL_ACTIONS') return `Всего принято решений: ${range}`;
  if (scope.kind === 'STAGE')
    return `На этапе «${stageLabel(presentationFor(state), scope.stage)}» принято решений: ${range}`;
  if (scope.kind === 'ACTIONS')
    return `Решения из списка применили суммарно ${range}: ${scope.titles.join('; ')}`;
  const period = scope.sinceStageSeen
    ? `После последнего решения на этапе «${stageLabel(presentationFor(state), scope.sinceStage)}»`
    : 'С начала игры';
  if (scope.titles) {
    return `${period} решения из списка применили суммарно ${range}: ${scope.titles.join('; ')}`;
  }
  return `${period} на этапе «${stageLabel(presentationFor(state), scope.stage)}» принято решений: ${range}`;
}

function countRange(minimum?: number, maximum?: number, repetitions = false) {
  const count = maximum ?? minimum;
  const suffix =
    repetitions && count !== undefined ? ` ${repetitionWord(count, minimum !== maximum)}` : '';
  if (minimum !== undefined && minimum === maximum) return `${minimum}${suffix}`;
  if (minimum !== undefined && maximum !== undefined) return `от ${minimum} до ${maximum}${suffix}`;
  if (minimum !== undefined) return `не меньше ${minimum}${suffix}`;
  if (maximum !== undefined) return `не больше ${maximum}${suffix}`;
  return repetitions ? 'любое число раз' : 'любое число';
}

function repetitionWord(count: number, genitive: boolean) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (genitive) return mod10 === 1 && mod100 !== 11 ? 'раза' : 'раз';
  return [2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100) ? 'раза' : 'раз';
}

function conditionStatus(condition: ForecastPredicateView) {
  const status = condition.satisfied ? 'Выполнено' : 'Не выполнено';
  return condition.kind === 'COUNT' ? `${status} · сейчас ${condition.actual}` : status;
}

function StageOutcomes({
  outcomes,
  state,
}: {
  outcomes: { stage: StageKey; states: StageState[] }[];
  state: GameState;
}) {
  if (outcomes.length === 0) {
    return <span className="potential-stages">Этапы останутся как есть</span>;
  }
  return (
    <span className="potential-stages">
      {outcomes.map((outcome) => (
        <span key={outcome.stage}>
          {stageLabel(presentationFor(state), outcome.stage)} →{' '}
          {outcome.states
            .map((value) => presentationFor(state).stageStateLabels[value])
            .join(' / ')}
        </span>
      ))}
    </span>
  );
}

function isChangedRange(range: MetricPotentialRange | undefined) {
  return Boolean(range && (range.minimum !== 0 || range.maximum !== 0));
}

function formatRange(range: MetricPotentialRange | undefined) {
  if (!range) return '0';
  if (range.minimum === range.maximum) return formatSigned(range.minimum);
  return `${formatSigned(range.minimum)}…${formatSigned(range.maximum)}`;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function rangeClass(range: MetricPotentialRange | undefined) {
  if (!range) return '';
  if (range.maximum <= 0) return 'is-negative';
  if (range.minimum >= 0) return 'is-positive';
  return 'is-mixed';
}

function valueClass(value: number) {
  return value < 0 ? 'is-negative' : 'is-positive';
}
