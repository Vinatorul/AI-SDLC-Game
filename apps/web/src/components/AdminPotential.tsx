import {
  type ActionPotentialView,
  type AdminForecast,
  type EventBranchView,
  type ForecastInfluence,
  type ForecastPredicateView,
  type GameState,
  type MetricPotentialRange,
  metricKeys,
  type StageKey,
  type StageState,
} from '@ai-sdlc/contracts';
import { propertyLabels, stageLabels, stageStateLabels } from '../labels';

type PotentialProps = { forecast?: AdminForecast | null; state: GameState };

export function StagePotential({ forecast, stage, state }: PotentialProps & { stage: StageKey }) {
  const potential = forecast?.stagePotentials.find((item) => item.stage === stage);
  if (!potential) return null;
  const metrics = metricKeys.filter((key) => isChangedRange(potential.metricRanges[key]));
  return (
    <span className="admin-potential">
      <small>Диапазон вариантов</small>
      <span className="potential-chips">
        {metrics.length === 0 && <span>Метрики без изменений</span>}
        {metrics.map((key) => (
          <span className={rangeClass(potential.metricRanges[key])} key={key}>
            {state.metricDefinitions[key].label} {formatRange(potential.metricRanges[key])}
          </span>
        ))}
      </span>
      <StageOutcomes outcomes={potential.stageChanges} />
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
  const metrics = metricKeys.filter((key) => (potential.metricDelta[key] ?? 0) !== 0);
  return (
    <div className="admin-potential">
      <small>Если выберут сейчас</small>
      <span className="potential-chips">
        {metrics.length === 0 && <span>Метрики без изменений</span>}
        {metrics.map((key) => (
          <span className={valueClass(potential.metricDelta[key] ?? 0)} key={key}>
            {state.metricDefinitions[key].label} {formatSigned(potential.metricDelta[key] ?? 0)}
          </span>
        ))}
      </span>
      <StageOutcomes
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
        <BranchGroup branches={branches} influence="IMPROVES" title="Может улучшить" />
        <BranchGroup branches={branches} influence="WORSENS" title="Может ухудшить" />
        <BranchGroup branches={branches} influence="MIXED" title="Смешанный результат" />
        <BranchGroup branches={branches} influence="NEUTRAL" title="Без изменения баллов" />
      </div>
    </details>
  );
}

type HelpfulConditionsProps = { potential: ActionPotentialView; state: GameState };

function HelpfulConditions({ potential, state }: HelpfulConditionsProps) {
  const activationRequirements = potential.activationRequirements ?? [];
  const positiveEffectRequirements = potential.positiveEffectRequirements ?? [];
  if (activationRequirements.length === 0 && positiveEffectRequirements.length === 0) return null;
  return (
    <section className="condition-group influence-positive">
      <h4>Помогает получить плюс</h4>
      <ul>
        {activationRequirements.map((item) => (
          <ConditionRow
            key={`activation:${item.actionId}`}
            satisfied={item.satisfied}
            title={item.title}
          />
        ))}
        {positiveEffectRequirements.map((item) => (
          <ConditionRow
            key={`effect:${item.metric}:${item.stage}`}
            satisfied={item.satisfied}
            title={`${state.metricDefinitions[item.metric].label}: этап «${stageLabels[item.stage]}» работает`}
          />
        ))}
      </ul>
    </section>
  );
}

function BranchGroup({ branches, influence, title }: BranchGroupProps) {
  const relevant = branches.filter((branch) => branch.influence === influence);
  if (relevant.length === 0) return null;
  return (
    <section className={`condition-group influence-${influence.toLowerCase()}`}>
      <h4>{title}</h4>
      {relevant.map((branch) => (
        <EventBranch branch={branch} key={branch.eventId} />
      ))}
    </section>
  );
}

type BranchGroupProps = {
  branches: EventBranchView[];
  influence: ForecastInfluence;
  title: string;
};

function EventBranch({ branch }: { branch: EventBranchView }) {
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
            title={predicateTitle(condition)}
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
      <b>{status ?? (satisfied ? 'Активно' : 'Неактивно')}</b>
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

function predicateTitle(condition: ForecastPredicateView): string {
  if (condition.kind === 'ACTION_HISTORY') {
    const prefix =
      condition.expected === 'APPLIED' ? 'Раньше выбраны все' : 'Раньше не выбрано ни одно';
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
    return `${timing} ${presence}: ${propertyLabels[condition.property]}`;
  }
  if (condition.kind === 'STAGE_STATE') {
    return `Этап «${stageLabels[condition.stage]}»: ${stageStateLabels[condition.expected]}`;
  }
  return countTitle(condition);
}

function countTitle(condition: Extract<ForecastPredicateView, { kind: 'COUNT' }>) {
  const range = countRange(condition.minimum, condition.maximum);
  const { scope } = condition;
  if (scope.kind === 'ALL_ACTIONS') return `Всего принято решений: ${range}`;
  if (scope.kind === 'STAGE') return `На этапе «${stageLabels[scope.stage]}» выбрано: ${range}`;
  if (scope.kind === 'ACTIONS') return `Эти решения выбирали ${range}: ${scope.titles.join('; ')}`;
  const period = scope.sinceStageSeen
    ? `После последнего решения на этапе «${stageLabels[scope.sinceStage]}»`
    : 'С начала игры';
  if (scope.titles) {
    return `${period} выбирали ${range}: ${scope.titles.join('; ')}`;
  }
  return `${period} на этапе «${stageLabels[scope.stage]}» выбрано: ${range}`;
}

function countRange(minimum?: number, maximum?: number) {
  if (minimum !== undefined && minimum === maximum) return `${minimum}`;
  if (minimum !== undefined && maximum !== undefined) return `от ${minimum} до ${maximum}`;
  if (minimum !== undefined) return `не меньше ${minimum}`;
  if (maximum !== undefined) return `не больше ${maximum}`;
  return 'любое число раз';
}

function conditionStatus(condition: ForecastPredicateView) {
  if (condition.kind !== 'COUNT') return condition.satisfied ? 'Активно' : 'Неактивно';
  return `${condition.satisfied ? 'Активно' : 'Неактивно'} · сейчас ${condition.actual}`;
}

function StageOutcomes({ outcomes }: { outcomes: { stage: StageKey; states: StageState[] }[] }) {
  if (outcomes.length === 0) {
    return <span className="potential-stages">Этапы останутся как есть</span>;
  }
  return (
    <span className="potential-stages">
      {outcomes.map((outcome) => (
        <span key={outcome.stage}>
          {stageLabels[outcome.stage]} →{' '}
          {outcome.states.map((value) => stageStateLabels[value]).join(' / ')}
        </span>
      ))}
    </span>
  );
}

function isChangedRange(range: MetricPotentialRange) {
  return range.minimum !== 0 || range.maximum !== 0;
}

function formatRange(range: MetricPotentialRange) {
  if (range.minimum === range.maximum) return formatSigned(range.minimum);
  return `${formatSigned(range.minimum)}…${formatSigned(range.maximum)}`;
}

function formatSigned(value: number) {
  return value > 0 ? `+${value}` : String(value);
}

function rangeClass(range: MetricPotentialRange) {
  if (range.maximum <= 0) return 'is-negative';
  if (range.minimum >= 0) return 'is-positive';
  return 'is-mixed';
}

function valueClass(value: number) {
  return value < 0 ? 'is-negative' : 'is-positive';
}
