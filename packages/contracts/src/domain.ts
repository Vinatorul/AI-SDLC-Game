export const metricKeys = ['deliverySpeed', 'controllability', 'teamCapacity', 'quality'] as const;

export const stageKeys = [
  'businessRequest',
  'productDiscovery',
  'technicalDiscovery',
  'coding',
  'review',
  'testing',
  'deployment',
  'support',
] as const;

export const processProperties = [
  'humanReview',
  'automatedTests',
  'currentContext',
  'observability',
  'rollback',
] as const;

export type MetricKey = (typeof metricKeys)[number];
export type MetricValues = Record<MetricKey, number>;
export type MetricDelta = Partial<MetricValues>;
export type MetricReasons = Partial<Record<MetricKey, string>>;
export type MetricBounds = {
  maximum: number;
  minimum: number;
};
export type MetricDefinition = {
  description: string;
  label: string;
  maximumDescription: string;
  maximumLabel: string;
  minimumDescription: string;
  minimumLabel: string;
};
export type MetricDefinitions = Record<MetricKey, MetricDefinition>;
export type MetricImpact = 'IMPROVED' | 'MIXED' | 'NEUTRAL' | 'WORSENED';
export type StageKey = (typeof stageKeys)[number];
export type ProcessProperty = (typeof processProperties)[number];
export type StageState = 'AS_IS' | 'AI_ENABLED' | 'BROKEN';
export type GamePhase = 'LOBBY' | 'VOTING' | 'RESULT' | 'EVENT' | 'FEEDBACK' | 'WON' | 'BROKEN';
export type EvidenceKind = 'FACT' | 'SCENARIO';
export type DecisionModel = 'SINGLE_OPTION_V1' | 'STAGE_ACTION_V2';
export type BallotKind = 'LEGACY_OPTION' | 'STAGE' | 'ACTION';

export type GameRules = {
  criticalThreshold: number;
  dangerThreshold: number;
  minAiStagesToWin: number;
  notableVoteShare: number;
  requireNoBrokenStages: boolean;
  roundLimit: number;
  roundMode?: 'CYCLIC' | 'FINITE';
  shuffleActionChoices?: boolean;
};

export type StageMutation = {
  stage: StageKey;
  state: StageState;
};

export type RoundOption = {
  description: string;
  evidence: EvidenceKind;
  id: string;
  key: string;
  shortFeedback: string | null;
  stage: StageKey;
  title: string;
};

export type StageBallotChoice = {
  description: string;
  id: StageKey;
  kind: 'STAGE';
  stage: StageKey;
  title: string;
};

export type ActionBallotChoice = RoundOption & {
  kind: 'ACTION';
  repeatable: boolean;
};

export type LegacyOptionBallotChoice = RoundOption & {
  kind: 'LEGACY_OPTION';
};

export type BallotChoice = StageBallotChoice | ActionBallotChoice | LegacyOptionBallotChoice;

export type GameEvent = {
  description: string;
  evidence: EvidenceKind;
  id: string;
  title: string;
};

export type BallotTally = {
  choiceId: string;
  count: number;
  share: number;
};

export type VoteTally = {
  count: number;
  optionId: string;
  share: number;
};

export type BallotView<TChoice extends BallotChoice = BallotChoice> = {
  choices: TChoice[];
  id: string;
  kind: BallotKind;
  selectedChoiceId: string | null;
  stage: StageKey | null;
  tiedChoiceIds: string[];
  voteTallies: BallotTally[];
};

export type AppliedActionView = {
  actionId: string;
  impact?: AppliedActionImpactView;
  roundNumber: number;
  stage: StageKey;
  title: string;
};

export type AppliedActionImpactView = {
  metricDelta: MetricDelta;
  reasons: Partial<Record<MetricKey, string[]>>;
};

export type MetricPotentialRange = {
  maximum: number;
  minimum: number;
};

export type StageStatePotential = {
  stage: StageKey;
  states: StageState[];
};

export type ActivationRequirementView = {
  actionId: string;
  satisfied: boolean;
  title: string;
};

export type ForecastInfluence = 'IMPROVES' | 'MIXED' | 'NEUTRAL' | 'WORSENS';

export type ForecastPredicateView =
  | {
      actionIds: string[];
      kind: 'ACTION_HISTORY';
      satisfied: boolean;
      titles: string[];
      expected: 'APPLIED' | 'NOT_APPLIED';
    }
  | {
      expected: 'ABSENT' | 'PRESENT';
      kind: 'PROPERTY';
      property: ProcessProperty;
      satisfied: boolean;
      timing: 'AFTER_ACTION' | 'BEFORE_ACTION';
    }
  | {
      expected: StageState;
      kind: 'STAGE_STATE';
      satisfied: boolean;
      stage: StageKey;
    }
  | {
      actual: number;
      kind: 'COUNT';
      maximum?: number;
      minimum?: number;
      satisfied: boolean;
      scope: ForecastCountScopeView;
    };

export type ForecastCountScopeView =
  | { actionIds: string[]; kind: 'ACTIONS'; titles: string[] }
  | { kind: 'ALL_ACTIONS' }
  | { kind: 'STAGE'; stage: StageKey }
  | {
      actionIds?: string[];
      kind: 'STAGE_SINCE_LAST';
      sinceStage: StageKey;
      sinceStageSeen: boolean;
      stage: StageKey;
      titles?: string[];
    };

export type EventBranchView = {
  conditions: ForecastPredicateView[];
  eventId: string;
  influence: ForecastInfluence;
  matched: boolean;
  selected: boolean;
  title: string;
};

export type PositiveEffectRequirementView = {
  metric: MetricKey;
  satisfied: boolean;
  stage: StageKey;
};

export type ActionPotentialView = {
  actionId: string;
  activationRequirements: ActivationRequirementView[];
  eventBranches: EventBranchView[];
  metricDelta: MetricDelta;
  positiveEffectRequirements: PositiveEffectRequirementView[];
  stageChanges: StageMutation[];
};

export type StagePotentialView = {
  actionCount: number;
  metricRanges: Record<MetricKey, MetricPotentialRange>;
  stage: StageKey;
  stageChanges: StageStatePotential[];
};

export type AdminForecast = {
  actionPotentials: ActionPotentialView[];
  ballotId: string | null;
  kind: 'ACTION' | 'STAGE' | null;
  revision: number;
  stagePotentials: StagePotentialView[];
  transitionVersion: number;
};

export type ActivatedAction = {
  actionId: string;
  completedByActionId: string;
  stage: StageKey;
};

export type BlockedActivation = ActivatedAction & {
  reason: 'STAGE_BROKEN' | 'STAGE_REPAIRED';
};

export type ActivatedActionView = ActivatedAction & {
  completedByTitle: string;
  title: string;
};

export type RecoveryActionView = {
  actionId: string;
  stage: StageKey;
  title: string;
};

export type RecoveryGuideView = {
  hostHint: string;
  prerequisiteActions: RecoveryActionView[];
  repairActions: RecoveryActionView[];
};

export type BlockedActivationView = BlockedActivation & {
  completedByTitle: string;
  recovery?: RecoveryGuideView;
  title: string;
};

export type StageProgress = {
  activeAiAction?: AppliedActionView | null;
  appliedActions: AppliedActionView[];
  state: StageState;
};

export type EffectBreakdown = {
  applied?: MetricDelta;
  decision: MetricDelta;
  event: MetricDelta;
  pipeline?: MetricDelta;
  properties: MetricDelta;
  total: MetricDelta;
};

type EffectContributionBase = {
  blockedByStages?: Partial<Record<MetricKey, StageKey[]>>;
  blockedEffect?: MetricDelta;
  effect: MetricDelta;
  effectReasons?: MetricReasons;
};

export type EffectContribution = EffectContributionBase &
  (
    | {
        description: string;
        kind: 'DECISION' | 'EVENT';
        title: string;
      }
    | {
        kind: 'PROPERTY';
        property: ProcessProperty;
      }
    | {
        kind: 'STAGE_STATE';
        stage: StageKey;
        state: StageState;
      }
  );

export type RoundView = {
  activatedActions?: ActivatedActionView[];
  blockedActivations?: BlockedActivationView[];
  effectBreakdown: EffectBreakdown | null;
  effectContributions?: EffectContribution[];
  event: GameEvent | null;
  id: string;
  metricImpact: MetricImpact | null;
  number: number;
  options: RoundOption[];
  recovery?: RecoveryGuideView | null;
  selectedOptionId: string | null;
  situation: string;
  tiedOptionIds: string[];
  title: string;
  voteTallies: VoteTally[];
};

export type GameState = {
  allowedCommands: AdminCommandName[];
  appliedActionHistory?: AppliedActionView[];
  code: string;
  currentBallot: BallotView | null;
  currentRound: RoundView | null;
  decisionModel: DecisionModel;
  metricBounds: MetricBounds;
  metricDefinitions: MetricDefinitions;
  metricScaleDescription: string;
  metrics: MetricValues;
  myVoteChoiceId: string | null;
  myVoteOptionId: string | null;
  outcomeReason: OutcomeReason | null;
  phase: GamePhase;
  playerCount: number;
  properties: ProcessProperty[];
  revision: number;
  roundIndex: number;
  rules: GameRules;
  stageProgress: Record<StageKey, StageProgress>;
  stages: Record<StageKey, StageState>;
  transitionVersion: number;
  voteCount: number;
};

export type OutcomeReason = 'CRITICAL_METRIC' | 'AI_NOT_EMBEDDED' | 'BROKEN_STAGES_REMAIN';

export type AdminCommandName =
  | 'OPEN_VOTING'
  | 'OPEN_NEXT_BALLOT'
  | 'CLOSE_VOTING'
  | 'RESOLVE_TIE'
  | 'SHOW_EVENT'
  | 'APPLY_CONSEQUENCES';

export type AdminCommand = {
  choiceId?: string;
  expectedTransitionVersion: number;
  optionId?: string;
  type: AdminCommandName;
};
