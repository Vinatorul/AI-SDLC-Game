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
  roundNumber: number;
  stage: StageKey;
  title: string;
};

export type StageProgress = {
  appliedActions: AppliedActionView[];
  state: StageState;
};

export type EffectBreakdown = {
  decision: MetricDelta;
  event: MetricDelta;
  properties: MetricDelta;
  total: MetricDelta;
};

export type RoundView = {
  effectBreakdown: EffectBreakdown | null;
  event: GameEvent | null;
  id: string;
  number: number;
  options: RoundOption[];
  selectedOptionId: string | null;
  situation: string;
  tiedOptionIds: string[];
  title: string;
  voteTallies: VoteTally[];
};

export type GameState = {
  allowedCommands: AdminCommandName[];
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
