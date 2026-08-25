import { metricKeys, processProperties, stageKeys } from '@ai-sdlc/contracts';
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
const stageMutationSchema = z.object({ stage: stageSchema, state: stageStateSchema }).strict();
const countRangeSchema = z
  .object({
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

const eventSchema = z
  .object({
    description: z.string().min(1),
    effect: metricDeltaSchema,
    evidence: z.enum(['FACT', 'SCENARIO']),
    id: z.string().min(1),
    stageChanges: z.array(stageMutationSchema),
    title: z.string().min(1),
  })
  .strict();

const eventRuleSchema = z
  .object({
    actionIds: z.array(z.string().min(1)).min(1).optional(),
    appliedActionCount: countRangeSchema.optional(),
    event: eventSchema,
    hasAppliedActions: z.array(z.string().min(1)).min(1).optional(),
    hasProperty: propertySchema.optional(),
    hasResultingProperty: propertySchema.optional(),
    missingAppliedActions: z.array(z.string().min(1)).min(1).optional(),
    missingProperty: propertySchema.optional(),
    missingResultingProperty: propertySchema.optional(),
    stageActionCounts: z.array(stageActionCountSchema).min(1).optional(),
    stageStates: z.array(stageMutationSchema).min(1).optional(),
  })
  .strict();

const stageActionSchema = z
  .object({
    addProperties: z.array(propertySchema),
    availableInStates: z.array(stageStateSchema).min(1),
    description: z.string().min(1),
    effect: metricDeltaSchema,
    evidence: z.enum(['FACT', 'SCENARIO']),
    key: z.string().min(1),
    repeatable: z.boolean(),
    resultingStageState: stageStateSchema,
    shortFeedback: z.string().min(1).nullable(),
    stage: stageSchema,
    title: z.string().min(1),
  })
  .strict();

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
  })
  .strict();

const mechanicsSchema = z
  .object({
    initialMetrics: metricValuesSchema,
    metricBounds: z.object({ maximum: z.number(), minimum: z.number() }).strict(),
    metricDefinitions: metricDefinitionsSchema,
    metricScaleDescription: z.string().min(1),
    propertyEffects: z
      .object({
        automatedTests: metricDeltaSchema,
        currentContext: metricDeltaSchema,
        humanReview: metricDeltaSchema,
        observability: metricDeltaSchema,
        rollback: metricDeltaSchema,
      })
      .strict(),
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
    schemaVersion: z.literal(3),
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
      addIssue(context, ['mechanics', 'initialMetrics', key], 'значение вне границ показателя');
    }
  }
  validateThresholds(scenario, context);
}

function validateThresholds(scenario: ScenarioCandidate, context: IssueContext) {
  const { maximum, minimum } = scenario.mechanics.metricBounds;
  const { criticalThreshold, dangerThreshold } = scenario.rules;
  if (criticalThreshold < minimum || criticalThreshold > maximum) {
    addIssue(context, ['rules', 'criticalThreshold'], 'порог вне границ показателя');
  }
  if (dangerThreshold <= criticalThreshold || dangerThreshold > maximum) {
    addIssue(context, ['rules', 'dangerThreshold'], 'должен быть выше criticalThreshold');
  }
}

function validateActionCatalog(scenario: ScenarioCandidate, context: IssueContext) {
  if (Object.keys(scenario.stageActions).length === 0) {
    addIssue(context, ['stageActions'], 'каталог действий не должен быть пустым');
  }
  Object.entries(scenario.stageActions).forEach(([id, action]) => {
    validateUnique(
      action.availableInStates,
      ['stageActions', id, 'availableInStates'],
      'состояние',
      context,
    );
  });
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
  });
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
    rule.stageActionCounts?.map(({ stage }) => stage) ?? [],
    path,
    'этап в stageActionCounts',
    context,
  );
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
      rule.hasAppliedActions ||
      rule.hasProperty ||
      rule.hasResultingProperty ||
      rule.missingAppliedActions ||
      rule.missingProperty ||
      rule.missingResultingProperty ||
      rule.stageActionCounts ||
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
