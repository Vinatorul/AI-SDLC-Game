import {
  type MetricDelta,
  type MetricReasons,
  metricKeys,
  processProperties,
  stageKeys,
} from '@ai-sdlc/contracts';
import { z } from 'zod';
import type { Scenario } from './types';

const metricDeltaSchema = z
  .object({
    controllability: z.number().optional(),
    deliverySpeed: z.number().optional(),
    quality: z.number().optional(),
    teamCapacity: z.number().optional(),
  })
  .strict();

const metricReasonsSchema = z
  .object({
    controllability: z.string().trim().min(1).optional(),
    deliverySpeed: z.string().trim().min(1).optional(),
    quality: z.string().trim().min(1).optional(),
    teamCapacity: z.string().trim().min(1).optional(),
  })
  .strict();

const metricValuesSchema = z
  .object({
    controllability: z.number(),
    deliverySpeed: z.number(),
    quality: z.number(),
    teamCapacity: z.number(),
  })
  .strict();

const metricDefinitionSchema = z
  .object({
    description: z.string().min(1),
    label: z.string().min(1),
    maximumDescription: z.string().min(1),
    maximumLabel: z.string().min(1),
    minimumDescription: z.string().min(1),
    minimumLabel: z.string().min(1),
  })
  .strict();

const metricDefinitionsSchema = z
  .object({
    controllability: metricDefinitionSchema,
    deliverySpeed: metricDefinitionSchema,
    quality: metricDefinitionSchema,
    teamCapacity: metricDefinitionSchema,
  })
  .strict();

const propertySchema = z.enum(processProperties);
const stageSchema = z.enum(stageKeys);
const stageStateSchema = z.enum(['AS_IS', 'AI_ENABLED', 'BROKEN']);
const requiredStagesSchema = z
  .array(stageSchema)
  .min(1)
  .refine((stages) => new Set(stages).size === stages.length, 'этапы не должны повторяться');
const stageEffectRequirementsSchema = z
  .object({
    businessRequest: requiredStagesSchema.optional(),
    coding: requiredStagesSchema.optional(),
    deployment: requiredStagesSchema.optional(),
    productDiscovery: requiredStagesSchema.optional(),
    review: requiredStagesSchema.optional(),
    support: requiredStagesSchema.optional(),
    technicalDiscovery: requiredStagesSchema.optional(),
    testing: requiredStagesSchema.optional(),
  })
  .strict();
const additionalRequiredStagesSchema = z
  .object({
    controllability: stageEffectRequirementsSchema.optional(),
    deliverySpeed: stageEffectRequirementsSchema.optional(),
    quality: stageEffectRequirementsSchema.optional(),
    teamCapacity: stageEffectRequirementsSchema.optional(),
  })
  .strict();
const positiveEffectRequirementsSchema = z
  .object({
    additionalStages: additionalRequiredStagesSchema.optional(),
    requireActionStage: z.boolean(),
  })
  .strict();
const stageMutationSchema = z.object({ stage: stageSchema, state: stageStateSchema }).strict();
const stageTransitionsSchema = z
  .object({
    AI_ENABLED: stageStateSchema,
    AS_IS: stageStateSchema,
    BROKEN: stageStateSchema,
  })
  .strict();
const countRangeSchema = z
  .object({
    maximum: z.number().int().min(0).optional(),
    minimum: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((range) => isValidRange(range), 'minimum не должен быть больше maximum');

const appliedActionCountConditionSchema = z
  .object({
    actionIds: z.array(z.string().min(1)).min(1),
    maximum: z.number().int().min(0).optional(),
    minimum: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((range) => isValidRange(range), 'minimum не должен быть больше maximum');

const stageActionCountSchema = z
  .object({
    maximum: z.number().int().min(0).optional(),
    minimum: z.number().int().min(0).optional(),
    stage: stageSchema,
  })
  .strict()
  .refine((range) => isValidRange(range), 'minimum не должен быть больше maximum');

const stageActionCountSinceLastSchema = z
  .object({
    actionIds: z.array(z.string().min(1)).min(1).optional(),
    maximum: z.number().int().min(0).optional(),
    minimum: z.number().int().min(0).optional(),
    sinceStage: stageSchema,
    stage: stageSchema,
  })
  .strict()
  .refine((range) => isValidRange(range), 'minimum не должен быть больше maximum');

const eventSchema = z
  .object({
    description: z.string().min(1),
    effect: metricDeltaSchema,
    effectReasons: metricReasonsSchema.optional(),
    evidence: z.enum(['FACT', 'SCENARIO']),
    id: z.string().min(1),
    addProperties: z.array(propertySchema).optional(),
    removeProperties: z.array(propertySchema).optional(),
    repeatEffect: metricDeltaSchema.optional(),
    repeatEffectReasons: metricReasonsSchema.optional(),
    stageChanges: z.array(stageMutationSchema),
    title: z.string().min(1),
  })
  .strict();

const eventRuleSchema = z
  .object({
    actionIds: z.array(z.string().min(1)).min(1).optional(),
    appliedActionCounts: z.array(appliedActionCountConditionSchema).min(1).optional(),
    appliedActionCount: countRangeSchema.optional(),
    event: eventSchema,
    hasAppliedActions: z.array(z.string().min(1)).min(1).optional(),
    hasProperty: propertySchema.optional(),
    hasResultingProperty: propertySchema.optional(),
    missingAppliedActions: z.array(z.string().min(1)).min(1).optional(),
    missingProperty: propertySchema.optional(),
    missingResultingProperty: propertySchema.optional(),
    stageActionCounts: z.array(stageActionCountSchema).min(1).optional(),
    stageActionCountsSinceLast: z.array(stageActionCountSinceLastSchema).min(1).optional(),
    stageStates: z.array(stageMutationSchema).min(1).optional(),
  })
  .strict();

const stageActionBaseSchema = z
  .object({
    activationRequirements: z.array(z.string().min(1)).min(1).optional(),
    addProperties: z.array(propertySchema),
    availableInStates: z.array(stageStateSchema).min(1),
    description: z.string().min(1),
    effect: metricDeltaSchema,
    effectReasons: metricReasonsSchema.optional(),
    evidence: z.enum(['FACT', 'SCENARIO']),
    key: z.string().min(1),
    repeatable: z.boolean(),
    repeatEffect: metricDeltaSchema.optional(),
    repeatEffectReasons: metricReasonsSchema.optional(),
    shortFeedback: z.string().min(1).nullable(),
    stage: stageSchema,
    title: z.string().min(1),
  })
  .strict();

const stageActionSchema = z.union([
  stageActionBaseSchema.extend({ resultingStageState: stageStateSchema }).strict(),
  stageActionBaseSchema.extend({ stageTransitions: stageTransitionsSchema }).strict(),
]);

const stageChoiceSchema = z
  .object({
    actionIds: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    stage: stageSchema,
    title: z.string().min(1),
  })
  .strict();

const roundSchema = z
  .object({
    eventRules: z.array(eventRuleSchema).min(1),
    id: z.string().min(1),
    number: z.number().int().positive(),
    situation: z.string().min(1),
    stageChoices: z.array(stageChoiceSchema).min(2).max(stageKeys.length),
    title: z.string().min(1),
  })
  .strict();

const rulesSchema = z
  .object({
    criticalThreshold: z.number(),
    dangerThreshold: z.number(),
    minAiStagesToWin: z.number().int().min(0).max(stageKeys.length),
    notableVoteShare: z.number().min(0).max(1),
    requireNoBrokenStages: z.boolean(),
    roundLimit: z.number().int().positive(),
    roundMode: z.enum(['CYCLIC', 'FINITE']),
    shuffleActionChoices: z.boolean().optional(),
  })
  .strict();

const mechanicsSchema = z
  .object({
    initialMetrics: metricValuesSchema,
    metricBounds: z.object({ maximum: z.number(), minimum: z.number() }).strict(),
    metricDefinitions: metricDefinitionsSchema,
    metricScaleDescription: z.string().min(1),
    positiveEffectRequirements: positiveEffectRequirementsSchema.optional(),
    propertyEffects: z
      .object({
        automatedTests: metricDeltaSchema,
        currentContext: metricDeltaSchema,
        humanReview: metricDeltaSchema,
        observability: metricDeltaSchema,
        rollback: metricDeltaSchema,
      })
      .strict(),
    propertyEffectReasons: z
      .object({
        automatedTests: metricReasonsSchema.optional(),
        currentContext: metricReasonsSchema.optional(),
        humanReview: metricReasonsSchema.optional(),
        observability: metricReasonsSchema.optional(),
        rollback: metricReasonsSchema.optional(),
      })
      .strict()
      .optional(),
    stageStateEffects: z
      .object({
        AI_ENABLED: metricDeltaSchema,
        AS_IS: metricDeltaSchema,
        BROKEN: metricDeltaSchema,
      })
      .strict()
      .optional(),
    stageStateEffectReasons: z
      .object({
        AI_ENABLED: metricReasonsSchema.optional(),
        AS_IS: metricReasonsSchema.optional(),
        BROKEN: metricReasonsSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const scenarioSchema = z
  .object({
    contentStatus: z.enum(['READY', 'TECHNICAL_DRAFT']),
    decisionModel: z.literal('STAGE_ACTION_V2'),
    id: z.string().min(1),
    mechanics: mechanicsSchema,
    rounds: z.array(roundSchema).min(1),
    rules: rulesSchema,
    schemaVersion: z.literal(4),
    stageActions: z.record(z.string().min(1), stageActionSchema),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateScenario);

type ScenarioCandidate = z.infer<typeof scenarioSchema>;
type IssueContext = Parameters<Parameters<typeof scenarioSchema.superRefine>[0]>[1];

export function parseScenario(input: unknown): Scenario {
  const result = scenarioSchema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'scenario'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Сценарий не прошёл проверку: ${details}`);
}

function validateScenario(scenario: ScenarioCandidate, context: IssueContext) {
  validateUnique(
    scenario.rounds.map(({ id }) => id),
    ['rounds'],
    'id раунда',
    context,
  );
  validateRoundNumbers(scenario, context);
  validateMechanics(scenario, context);
  validateActionCatalog(scenario, context);
  scenario.rounds.forEach((round, index) => {
    validateRound(scenario, round, index, context);
  });
}

function validateRoundNumbers(scenario: ScenarioCandidate, context: IssueContext) {
  if (scenario.rules.roundLimit !== scenario.rounds.length) {
    addIssue(context, ['rules', 'roundLimit'], 'должен совпадать с числом шаблонов раундов');
  }
  scenario.rounds.forEach((round, index) => {
    if (round.number !== index + 1) {
      addIssue(context, ['rounds', index, 'number'], 'номера должны идти с 1 без пропусков');
    }
  });
}

function validateMechanics(scenario: ScenarioCandidate, context: IssueContext) {
  const { maximum, minimum } = scenario.mechanics.metricBounds;
  if (minimum >= maximum) {
    addIssue(context, ['mechanics', 'metricBounds'], 'minimum должен быть меньше maximum');
  }
  if (minimum >= 0 || maximum <= 0) {
    addIssue(
      context,
      ['mechanics', 'metricBounds'],
      'границы должны находиться по обе стороны от 0',
    );
  }
  for (const key of metricKeys) {
    const value = scenario.mechanics.initialMetrics[key];
    if (value < minimum || value > maximum) {
      addIssue(context, ['mechanics', 'initialMetrics', key], 'значение вне границ метрики');
    }
  }
  validateThresholds(scenario, context);
  validateMechanicReasons(scenario, context);
}

function validateMechanicReasons(scenario: ScenarioCandidate, context: IssueContext) {
  for (const property of processProperties) {
    validateEffectReasons(
      scenario.mechanics.propertyEffects[property],
      scenario.mechanics.propertyEffectReasons?.[property],
      ['mechanics', 'propertyEffectReasons', property],
      context,
    );
  }
  for (const state of ['AS_IS', 'AI_ENABLED', 'BROKEN'] as const) {
    validateEffectReasons(
      scenario.mechanics.stageStateEffects?.[state] ?? {},
      scenario.mechanics.stageStateEffectReasons?.[state],
      ['mechanics', 'stageStateEffectReasons', state],
      context,
    );
  }
}

function validateThresholds(scenario: ScenarioCandidate, context: IssueContext) {
  const { maximum, minimum } = scenario.mechanics.metricBounds;
  const { criticalThreshold, dangerThreshold } = scenario.rules;
  if (criticalThreshold < minimum || criticalThreshold > maximum) {
    addIssue(context, ['rules', 'criticalThreshold'], 'порог вне границ метрики');
  }
  if (dangerThreshold <= criticalThreshold || dangerThreshold > maximum) {
    addIssue(context, ['rules', 'dangerThreshold'], 'должен быть выше criticalThreshold');
  }
}

function validateActionCatalog(scenario: ScenarioCandidate, context: IssueContext) {
  const actionIds = new Set(Object.keys(scenario.stageActions));
  if (actionIds.size === 0) {
    addIssue(context, ['stageActions'], 'каталог действий не должен быть пустым');
  }
  Object.entries(scenario.stageActions).forEach(([id, action]) => {
    validateAction(id, action, actionIds, context);
  });
}

function validateAction(
  id: string,
  action: ScenarioCandidate['stageActions'][string],
  actionIds: Set<string>,
  context: IssueContext,
) {
  validateUnique(
    action.availableInStates,
    ['stageActions', id, 'availableInStates'],
    'состояние',
    context,
  );
  const path = ['stageActions', id, 'activationRequirements'] as (string | number)[];
  validateUnique(action.activationRequirements ?? [], path, 'требование активации', context);
  validateKnown(action.activationRequirements, actionIds, path, context);
  if (action.activationRequirements?.includes(id)) {
    addIssue(context, path, 'не должно ссылаться на себя');
  }
  if (
    action.activationRequirements &&
    (!('resultingStageState' in action) || action.resultingStageState !== 'AI_ENABLED')
  ) {
    addIssue(context, path, 'допустимо только для действия с результатом AI_ENABLED');
  }
  validateEffectReasons(
    action.effect,
    action.effectReasons,
    ['stageActions', id, 'effectReasons'],
    context,
  );
  validateOptionalEffectReasons(
    action.repeatEffect,
    action.repeatEffectReasons,
    ['stageActions', id, 'repeatEffectReasons'],
    context,
  );
  validateUnique(action.addProperties, ['stageActions', id, 'addProperties'], 'свойство', context);
}

function validateRound(
  scenario: ScenarioCandidate,
  round: ScenarioCandidate['rounds'][number],
  index: number,
  context: IssueContext,
) {
  validateUnique(
    round.stageChoices.map(({ stage }) => stage),
    ['rounds', index, 'stageChoices'],
    'этап',
    context,
  );
  validateUnique(
    round.eventRules.map(({ event }) => event.id),
    ['rounds', index, 'eventRules'],
    'id события',
    context,
  );
  round.stageChoices.forEach((choice, choiceIndex) => {
    validateStageChoice(scenario, choice, [index, choiceIndex], context);
  });
  validateEventRules(scenario, round, index, context);
}

function validateStageChoice(
  scenario: ScenarioCandidate,
  choice: ScenarioCandidate['rounds'][number]['stageChoices'][number],
  indexes: [number, number],
  context: IssueContext,
) {
  const path = ['rounds', indexes[0], 'stageChoices', indexes[1]] as (string | number)[];
  validateUnique(choice.actionIds, [...path, 'actionIds'], 'id действия', context);
  for (const actionId of choice.actionIds) {
    const action = scenario.stageActions[actionId];
    if (!action) addIssue(context, [...path, 'actionIds'], `неизвестный ${actionId}`);
    else if (action.stage !== choice.stage) {
      addIssue(context, [...path, 'actionIds'], `${actionId} относится к другому этапу`);
    }
  }
  const keys = choice.actionIds.flatMap((id) => scenario.stageActions[id]?.key ?? []);
  validateUnique(keys, [...path, 'actionIds'], 'key действия', context);
}

function validateEventRules(
  scenario: ScenarioCandidate,
  round: ScenarioCandidate['rounds'][number],
  roundIndex: number,
  context: IssueContext,
) {
  const lastIndex = round.eventRules.length - 1;
  round.eventRules.forEach((rule, index) => {
    const path = ['rounds', roundIndex, 'eventRules', index] as (string | number)[];
    validateRuleConditions(rule, path, context);
    if (index === lastIndex && hasCondition(rule))
      addIssue(context, path, 'последнее событие должно быть безусловным');
    if (index < lastIndex && !hasCondition(rule))
      addIssue(context, path, 'безусловным может быть только последнее событие');
    validateRuleReferences(scenario, round, rule, path, context);
    validateEffectReasons(
      rule.event.effect,
      rule.event.effectReasons,
      [...path, 'event', 'effectReasons'],
      context,
    );
    validateOptionalEffectReasons(
      rule.event.repeatEffect,
      rule.event.repeatEffectReasons,
      [...path, 'event', 'repeatEffectReasons'],
      context,
    );
    validateEventProperties(rule.event, [...path, 'event'], context);
  });
}

function validateEventProperties(
  event: ScenarioCandidate['rounds'][number]['eventRules'][number]['event'],
  path: (string | number)[],
  context: IssueContext,
) {
  validateUnique(event.addProperties ?? [], [...path, 'addProperties'], 'свойство', context);
  validateUnique(event.removeProperties ?? [], [...path, 'removeProperties'], 'свойство', context);
  const added = new Set(event.addProperties ?? []);
  if ((event.removeProperties ?? []).some((property) => added.has(property))) {
    addIssue(context, path, 'свойство нельзя одновременно добавить и удалить');
  }
}

function validateEffectReasons(
  effect: MetricDelta,
  reasons: MetricReasons | undefined,
  path: (string | number)[],
  context: IssueContext,
) {
  const effectKeys = metricKeys.filter((key) => effect[key] !== undefined && effect[key] !== 0);
  const reasonKeys = metricKeys.filter((key) => reasons?.[key] !== undefined);
  if (sameKeys(effectKeys, reasonKeys)) return;
  addIssue(context, path, 'нужна отдельная причина для каждого ненулевого эффекта');
}

function validateOptionalEffectReasons(
  effect: MetricDelta | undefined,
  reasons: MetricReasons | undefined,
  path: (string | number)[],
  context: IssueContext,
) {
  if (effect !== undefined) validateEffectReasons(effect, reasons, path, context);
  else if (reasons !== undefined) addIssue(context, path, 'причины требуют repeatEffect');
}

function sameKeys(left: string[], right: string[]) {
  return left.length === right.length && left.every((key) => right.includes(key));
}

function validateRuleConditions(
  rule: ScenarioCandidate['rounds'][number]['eventRules'][number],
  path: (string | number)[],
  context: IssueContext,
) {
  if (rule.hasProperty && rule.hasProperty === rule.missingProperty) {
    addIssue(context, path, 'одно свойство нельзя одновременно требовать и исключать');
  }
  if (rule.hasResultingProperty && rule.hasResultingProperty === rule.missingResultingProperty) {
    addIssue(context, path, 'одно итоговое свойство нельзя одновременно требовать и исключать');
  }
  const required = new Set(rule.hasAppliedActions ?? []);
  if (rule.missingAppliedActions?.some((id) => required.has(id))) {
    addIssue(context, path, 'одно действие нельзя одновременно требовать и исключать');
  }
  validateUnique(
    rule.stageStates?.map(({ stage }) => stage) ?? [],
    path,
    'этап в stageStates',
    context,
  );
  validateUnique(
    rule.stageActionCountsSinceLast?.map(({ sinceStage, stage }) => `${stage}/${sinceStage}`) ?? [],
    path,
    'пара этапов в stageActionCountsSinceLast',
    context,
  );
  validateUnique(
    rule.stageActionCounts?.map(({ stage }) => stage) ?? [],
    path,
    'этап в stageActionCounts',
    context,
  );
  rule.appliedActionCounts?.forEach(({ actionIds }, index) => {
    validateUnique(actionIds, [...path, 'appliedActionCounts', index], 'actionId', context);
  });
  rule.stageActionCountsSinceLast?.forEach(({ actionIds }, index) => {
    validateUnique(
      actionIds ?? [],
      [...path, 'stageActionCountsSinceLast', index, 'actionIds'],
      'actionId',
      context,
    );
  });
}

function validateRuleReferences(
  scenario: ScenarioCandidate,
  round: ScenarioCandidate['rounds'][number],
  rule: ScenarioCandidate['rounds'][number]['eventRules'][number],
  path: (string | number)[],
  context: IssueContext,
) {
  const roundIds = new Set(round.stageChoices.flatMap(({ actionIds }) => actionIds));
  validateKnown(rule.actionIds, roundIds, [...path, 'actionIds'], context);
  const catalogIds = new Set(Object.keys(scenario.stageActions));
  rule.appliedActionCounts?.forEach(({ actionIds }, index) => {
    validateKnown(actionIds, catalogIds, [...path, 'appliedActionCounts', index], context);
  });
  rule.stageActionCountsSinceLast?.forEach(({ actionIds, stage }, index) => {
    const conditionPath = [...path, 'stageActionCountsSinceLast', index, 'actionIds'];
    validateKnown(actionIds, catalogIds, conditionPath, context);
    if (actionIds?.some((id) => scenario.stageActions[id]?.stage !== stage)) {
      addIssue(context, conditionPath, 'действие относится к другому этапу');
    }
  });
  validateKnown(rule.hasAppliedActions, catalogIds, [...path, 'hasAppliedActions'], context);
  validateKnown(
    rule.missingAppliedActions,
    catalogIds,
    [...path, 'missingAppliedActions'],
    context,
  );
}

function validateKnown(
  values: string[] | undefined,
  known: Set<string>,
  path: (string | number)[],
  context: IssueContext,
) {
  for (const value of values ?? []) {
    if (!known.has(value)) addIssue(context, path, `неизвестный ${value}`);
  }
}

function validateUnique(
  values: string[],
  path: (string | number)[],
  label: string,
  context: IssueContext,
) {
  if (new Set(values).size !== values.length)
    addIssue(context, path, `${label} должен быть уникальным`);
}

function hasCondition(rule: ScenarioCandidate['rounds'][number]['eventRules'][number]) {
  return Boolean(
    rule.actionIds ||
      rule.appliedActionCount ||
      rule.appliedActionCounts ||
      rule.hasAppliedActions ||
      rule.hasProperty ||
      rule.hasResultingProperty ||
      rule.missingAppliedActions ||
      rule.missingProperty ||
      rule.missingResultingProperty ||
      rule.stageActionCounts ||
      rule.stageActionCountsSinceLast ||
      rule.stageStates,
  );
}

function isValidRange(range: { maximum?: number; minimum?: number }) {
  if (range.maximum === undefined || range.minimum === undefined) return true;
  return range.minimum <= range.maximum;
}

function addIssue(context: IssueContext, path: (string | number)[], message: string) {
  context.addIssue({ code: 'custom', message, path });
}
