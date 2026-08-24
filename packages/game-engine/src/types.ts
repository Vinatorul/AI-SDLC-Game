import type {
  EffectBreakdown,
  GameEvent,
  GameRules,
  MetricDelta,
  MetricValues,
  ProcessProperty,
  RoundOption,
  StageKey,
  StageMutation,
  StageState,
} from '@ai-sdlc/contracts';

export type EngineOption = RoundOption & {
  addProperties: ProcessProperty[];
  effect: MetricDelta;
  stageChanges: StageMutation[];
};

export type EngineEvent = GameEvent & {
  effect: MetricDelta;
  stageChanges: StageMutation[];
};

export type EventRule = {
  event: EngineEvent;
  hasProperty?: ProcessProperty;
  missingProperty?: ProcessProperty;
  optionIds?: string[];
};

export type ScenarioRound = {
  eventRules: EventRule[];
  id: string;
  number: number;
  options: EngineOption[];
  situation: string;
  title: string;
};

export type MetricBounds = {
  maximum: number;
  minimum: number;
};

export type ScenarioMechanics = {
  initialMetrics: MetricValues;
  metricBounds: MetricBounds;
  propertyEffects: Record<ProcessProperty, MetricDelta>;
};

export type Scenario = {
  contentStatus: 'READY' | 'TECHNICAL_DRAFT';
  id: string;
  mechanics: ScenarioMechanics;
  rounds: ScenarioRound[];
  rules: GameRules;
  schemaVersion: 1;
  version: number;
};

export type EngineSnapshot = {
  metrics: MetricValues;
  properties: ProcessProperty[];
  stages: Record<StageKey, StageState>;
};

export type ResolutionPlan = {
  breakdown: EffectBreakdown;
  event: EngineEvent;
  metrics: MetricValues;
  properties: ProcessProperty[];
  stages: Record<StageKey, StageState>;
};

export type OutcomeEvaluation = {
  phase: 'FEEDBACK' | 'WON' | 'BROKEN';
  reason: 'CRITICAL_METRIC' | 'AI_NOT_EMBEDDED' | 'BROKEN_STAGES_REMAIN' | null;
};
