export const metricKeys = ['deliverySpeed', 'quality', 'controllability', 'teamCapacity'] as const;

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
export type StageKey = (typeof stageKeys)[number];
export type ProcessProperty = (typeof processProperties)[number];
export type StageState = 'AS_IS' | 'AI_ENABLED' | 'BROKEN';
export type GamePhase = 'LOBBY' | 'VOTING' | 'RESULT' | 'EVENT' | 'FEEDBACK' | 'WON' | 'BROKEN';
export type EvidenceKind = 'FACT' | 'SCENARIO';

export type GameRules = {
  criticalThreshold: number;
  dangerThreshold: number;
  minAiStagesToWin: number;
  notableVoteShare: number;
  requireNoBrokenStages: boolean;
  roundLimit: number;
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

export type GameEvent = {
  description: string;
  evidence: EvidenceKind;
  id: string;
  title: string;
};

export type VoteTally = {
  count: number;
  optionId: string;
  share: number;
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
  currentRound: RoundView | null;
  metrics: MetricValues;
  myVoteOptionId: string | null;
  outcomeReason: OutcomeReason | null;
  phase: GamePhase;
  playerCount: number;
  properties: ProcessProperty[];
  revision: number;
  roundIndex: number;
  rules: GameRules;
  stages: Record<StageKey, StageState>;
  transitionVersion: number;
  voteCount: number;
};

export type OutcomeReason = 'CRITICAL_METRIC' | 'AI_NOT_EMBEDDED' | 'BROKEN_STAGES_REMAIN';

export type AdminCommandName =
  | 'OPEN_VOTING'
  | 'CLOSE_VOTING'
  | 'RESOLVE_TIE'
  | 'SHOW_EVENT'
  | 'APPLY_CONSEQUENCES';

export type AdminCommand = {
  expectedTransitionVersion: number;
  optionId?: string;
  type: AdminCommandName;
};
