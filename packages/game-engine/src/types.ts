import type {
  ActivatedAction,
  BlockedActivation,
  EffectBreakdown,
  EffectContribution,
  GameEvent,
  GameRules,
  MetricBounds,
  MetricDefinitions,
  MetricDelta,
  MetricKey,
  MetricReasons,
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

type ActionStageResult =
  | { resultingStageState: StageState; stageTransitions?: never }
  | { resultingStageState?: never; stageTransitions: Record<StageState, StageState> };

export type StageAction = Omit<RoundOption, 'id'> &
  ActionStageResult & {
    activationRequirements?: string[];
    addProperties: ProcessProperty[];
    availableInStates: StageState[];
    effect: MetricDelta;
    effectReasons?: MetricReasons;
    repeatEffect?: MetricDelta;
    repeatEffectReasons?: MetricReasons;
    repeatable: boolean;
  };

export type EngineAction = StageAction & { id: string };
export type StageActionCatalog = Record<string, StageAction>;

export type PositiveEffectRequirements = {
  additionalStages?: Partial<Record<MetricKey, Partial<Record<StageKey, StageKey[]>>>>;
  requireActionStage: boolean;
};

export type EngineEvent = GameEvent & {
  addProperties?: ProcessProperty[];
  effect: MetricDelta;
  effectReasons?: MetricReasons;
  removeProperties?: ProcessProperty[];
  repeatEffect?: MetricDelta;
  repeatEffectReasons?: MetricReasons;
  stageChanges: StageMutation[];
};

export type EventRule = {
  actionIds?: string[];
  appliedActionCounts?: AppliedActionCountCondition[];
  appliedActionCount?: CountRange;
  event: EngineEvent;
  hasAppliedActions?: string[];
  hasProperty?: ProcessProperty;
  hasResultingProperty?: ProcessProperty;
  missingAppliedActions?: string[];
  missingProperty?: ProcessProperty;
  missingResultingProperty?: ProcessProperty;
  stageActionCounts?: StageActionCountCondition[];
  stageActionCountsSinceLast?: StageActionCountSinceLastCondition[];
  stageStates?: StageMutation[];
};

export type AppliedActionCountCondition = CountRange & { actionIds: string[] };
export type CountRange = { maximum?: number; minimum?: number };
export type StageActionCountCondition = CountRange & { stage: StageKey };
export type StageActionCountSinceLastCondition = CountRange & {
  actionIds?: string[];
  sinceStage: StageKey;
  stage: StageKey;
};

export type ScenarioStageChoice = {
  actionIds: string[];
  description: string;
  stage: StageKey;
  title: string;
};

export type ScenarioRound = {
  eventRules: EventRule[];
  id: string;
  number: number;
  situation: string;
  stageChoices: ScenarioStageChoice[];
  title: string;
};

export type GameMechanics = {
  initialMetrics: MetricValues;
  metricBounds: MetricBounds;
  positiveEffectRequirements?: PositiveEffectRequirements;
  propertyEffects: Record<ProcessProperty, MetricDelta>;
  propertyEffectReasons?: Partial<Record<ProcessProperty, MetricReasons>>;
  stageStateEffects?: Partial<Record<StageState, MetricDelta>>;
  stageStateEffectReasons?: Partial<Record<StageState, MetricReasons>>;
};

export type ScenarioMechanics = GameMechanics & {
  metricDefinitions: MetricDefinitions;
  metricScaleDescription: string;
};

export type Scenario = {
  contentStatus: 'READY' | 'TECHNICAL_DRAFT';
  decisionModel: 'STAGE_ACTION_V2';
  id: string;
  mechanics: ScenarioMechanics;
  rounds: ScenarioRound[];
  rules: GameRules;
  schemaVersion: 4;
  stageActions: StageActionCatalog;
  version: number;
};

export type AppliedAction = {
  actionId: string;
  roundNumber: number;
  stage: StageKey;
};

export type EngineSnapshot = {
  appliedActions: AppliedAction[];
  metrics: MetricValues;
  properties: ProcessProperty[];
  stages: Record<StageKey, StageState>;
};

export type ResolutionPlan = {
  activatedActions: ActivatedAction[];
  appliedActions: AppliedAction[];
  blockedActivations: BlockedActivation[];
  breakdown: EffectBreakdown;
  effectContributions: EffectContribution[];
  event: EngineEvent;
  metrics: MetricValues;
  properties: ProcessProperty[];
  stages: Record<StageKey, StageState>;
};

export type OutcomeEvaluation = {
  phase: 'FEEDBACK' | 'WON' | 'BROKEN';
  reason: 'CRITICAL_METRIC' | 'AI_NOT_EMBEDDED' | 'BROKEN_STAGES_REMAIN' | null;
};
