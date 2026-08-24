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

export type Scenario = {
  contentStatus: 'TECHNICAL_DRAFT';
  id: string;
  rounds: ScenarioRound[];
  rules: GameRules;
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
