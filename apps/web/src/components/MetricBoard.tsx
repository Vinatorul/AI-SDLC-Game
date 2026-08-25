import {
  type EffectBreakdown,
  type GameState,
  type MetricBounds,
  type MetricDefinition,
  type MetricDefinitions,
  type MetricKey,
  metricKeys,
} from '@ai-sdlc/contracts';

type MetricBoardProps = {
  breakdown?: EffectBreakdown | null;
  state: GameState;
};

type MetricDisplayConfig = {
  bounds: MetricBounds;
  definitions: MetricDefinitions;
  scaleDescription: string;
};

type MetricGaugeProps = {
  bounds: MetricBounds;
  definition: MetricDefinition;
  signed: boolean;
  value: number;
};

export function MetricBoard({ breakdown, state }: MetricBoardProps) {
  const config = metricConfig(state);
  return (
    <section className="metric-grid" aria-label="Показатели SDLC">
      <p className="metric-legend">{config.scaleDescription}</p>
      {metricKeys.map((key) => (
        <MetricCard breakdown={breakdown} config={config} key={key} metric={key} state={state} />
      ))}
    </section>
  );
}

function MetricCard({
  breakdown,
  config,
  metric,
  state,
}: MetricBoardProps & { config: MetricDisplayConfig; metric: MetricKey }) {
  const value = state.metrics[metric];
  const delta = breakdown?.total[metric] ?? 0;
  const definition = config.definitions[metric];
  const signed = config.bounds.minimum < 0;
  const zone = metricZone(value, state.rules.criticalThreshold, state.rules.dangerThreshold);
  return (
    <article
      aria-label={`${definition.label}: ${formatScore(value, signed)}. ${definition.description}`}
      className={`metric-card metric-${zone}${value < 0 ? ' metric-negative' : ''}`}
      title={metricTitle(definition, config.bounds)}
    >
      <MetricLabel definition={definition} delta={delta} />
      <strong>{formatScore(value, signed)}</strong>
      <p className="metric-description">{definition.description}</p>
      <MetricGauge bounds={config.bounds} definition={definition} signed={signed} value={value} />
    </article>
  );
}

function MetricLabel({ definition, delta }: { definition: MetricDefinition; delta: number }) {
  return (
    <div className="metric-label">
      <span>{definition.label}</span>
      {delta !== 0 && (
        <small className={delta < 0 ? 'metric-delta-negative' : ''}>
          {formatScore(delta, true)}
        </small>
      )}
    </div>
  );
}

function MetricGauge(props: MetricGaugeProps) {
  const { bounds, definition, signed, value } = props;
  const track = metricTrack(value, bounds);
  return (
    <>
      <div className="metric-track" aria-hidden="true">
        <i style={{ left: `${track.left}%`, width: `${track.width}%` }} />
        <b style={{ left: `${track.zero}%` }} />
      </div>
      <div className="metric-scale" aria-hidden="true">
        <span>
          <b>{formatScore(bounds.minimum, signed)}</b>
          {definition.minimumLabel}
        </span>
        <span>
          <b>{formatScore(bounds.maximum, signed)}</b>
          {definition.maximumLabel}
        </span>
      </div>
    </>
  );
}

function metricConfig(state: GameState): MetricDisplayConfig {
  const compatible = state as Partial<
    Pick<GameState, 'metricBounds' | 'metricDefinitions' | 'metricScaleDescription'>
  >;
  return {
    bounds: compatible.metricBounds ?? legacyMetricBounds,
    definitions: compatible.metricDefinitions ?? legacyMetricDefinitions,
    scaleDescription:
      compatible.metricScaleDescription ?? 'Чем выше значение, тем лучше состояние процесса',
  };
}

function metricZone(value: number, critical: number, danger: number) {
  if (value <= critical) return 'critical';
  if (value <= danger) return 'danger';
  return 'safe';
}

function metricTrack(value: number, bounds: MetricBounds) {
  const current = metricPosition(value, bounds);
  const zero = metricPosition(0, bounds);
  return { left: Math.min(current, zero), width: Math.abs(current - zero), zero };
}

function metricPosition(value: number, bounds: MetricBounds) {
  const clamped = Math.max(bounds.minimum, Math.min(bounds.maximum, value));
  return ((clamped - bounds.minimum) / (bounds.maximum - bounds.minimum)) * 100;
}

function metricTitle(definition: MetricDefinition, bounds: MetricBounds) {
  return `${definition.description}\n${bounds.minimum}: ${definition.minimumDescription}\n${bounds.maximum}: ${definition.maximumDescription}`;
}

function formatScore(value: number, signed: boolean) {
  return signed && value > 0 ? `+${value}` : String(value);
}

const legacyMetricBounds: MetricBounds = { maximum: 100, minimum: 0 };

const legacyMetricDefinitions: MetricDefinitions = {
  controllability: legacyDefinition('Управляемость', 'Насколько процесс остаётся управляемым.'),
  deliverySpeed: legacyDefinition(
    'Скорость поставки',
    'Как быстро изменения доходят до пользователей.',
  ),
  quality: legacyDefinition('Качество', 'Насколько надёжно работают выпущенные изменения.'),
  teamCapacity: legacyDefinition('Ресурс команды', 'Сколько рабочего ресурса осталось у команды.'),
};

function legacyDefinition(label: string, description: string): MetricDefinition {
  return {
    description,
    label,
    maximumDescription: 'Максимальное значение старой шкалы.',
    maximumLabel: 'Максимум',
    minimumDescription: 'Минимальное значение старой шкалы.',
    minimumLabel: 'Минимум',
  };
}
