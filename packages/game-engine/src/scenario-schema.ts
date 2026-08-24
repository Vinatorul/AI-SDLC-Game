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

const propertySchema = z.enum(processProperties);
const stageSchema = z.enum(stageKeys);
const stageMutationSchema = z
  .object({
    stage: stageSchema,
    state: z.enum(['AS_IS', 'AI_ENABLED', 'BROKEN']),
  })
  .strict();

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
    event: eventSchema,
    hasProperty: propertySchema.optional(),
    missingProperty: propertySchema.optional(),
    optionIds: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

const optionSchema = z
  .object({
    addProperties: z.array(propertySchema),
    description: z.string().min(1),
    effect: metricDeltaSchema,
    evidence: z.enum(['FACT', 'SCENARIO']),
    id: z.string().min(1),
    key: z.string().min(1),
    shortFeedback: z.string().min(1).nullable(),
    stage: stageSchema,
    stageChanges: z.array(stageMutationSchema),
    title: z.string().min(1),
  })
  .strict();

const roundSchema = z
  .object({
    eventRules: z.array(eventRuleSchema).min(1),
    id: z.string().min(1),
    number: z.number().int().positive(),
    options: z.array(optionSchema).length(4),
    situation: z.string().min(1),
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
  })
  .strict();

const mechanicsSchema = z
  .object({
    initialMetrics: metricValuesSchema,
    metricBounds: z.object({ maximum: z.number(), minimum: z.number() }).strict(),
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
    id: z.string().min(1),
    mechanics: mechanicsSchema,
    rounds: z.array(roundSchema).min(1),
    rules: rulesSchema,
    schemaVersion: z.literal(1),
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
    scenario.rounds.map((round) => round.id),
    ['rounds'],
    'id раунда',
    context,
  );
  validateRoundNumbers(scenario, context);
  validateMechanics(scenario, context);
  scenario.rounds.forEach((round, index) => {
    validateRound(round, index, context);
  });
}

function validateRoundNumbers(scenario: ScenarioCandidate, context: IssueContext) {
  if (scenario.rules.roundLimit !== scenario.rounds.length) {
    addIssue(context, ['rules', 'roundLimit'], 'должен совпадать с числом раундов');
  }
  scenario.rounds.forEach((round, index) => {
    if (round.number !== index + 1) {
      addIssue(
        context,
        ['rounds', index, 'number'],
        'номера раундов должны идти с 1 без пропусков',
      );
    }
  });
}

function validateMechanics(scenario: ScenarioCandidate, context: IssueContext) {
  const { maximum, minimum } = scenario.mechanics.metricBounds;
  if (minimum >= maximum) {
    addIssue(context, ['mechanics', 'metricBounds'], 'minimum должен быть меньше maximum');
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

function validateRound(
  round: ScenarioCandidate['rounds'][number],
  index: number,
  context: IssueContext,
) {
  validateUnique(
    round.options.map((option) => option.id),
    ['rounds', index, 'options'],
    'id варианта',
    context,
  );
  validateUnique(
    round.options.map((option) => option.key),
    ['rounds', index, 'options'],
    'key варианта',
    context,
  );
  validateUnique(
    round.eventRules.map((rule) => rule.event.id),
    ['rounds', index, 'eventRules'],
    'id события',
    context,
  );
  validateEventRules(round, index, context);
}

function validateEventRules(
  round: ScenarioCandidate['rounds'][number],
  roundIndex: number,
  context: IssueContext,
) {
  const lastIndex = round.eventRules.length - 1;
  round.eventRules.forEach((rule, index) => {
    const path = ['rounds', roundIndex, 'eventRules', index] as (string | number)[];
    if (rule.hasProperty && rule.hasProperty === rule.missingProperty) {
      addIssue(context, path, 'одно свойство нельзя одновременно требовать и исключать');
    }
    if (index === lastIndex && hasCondition(rule)) {
      addIssue(context, path, 'последнее событие должно быть безусловным');
    }
    if (index < lastIndex && !hasCondition(rule)) {
      addIssue(context, path, 'безусловным может быть только последнее событие');
    }
    validateOptionReferences(rule.optionIds, round, path, context);
  });
}

function validateOptionReferences(
  optionIds: string[] | undefined,
  round: ScenarioCandidate['rounds'][number],
  path: (string | number)[],
  context: IssueContext,
) {
  const knownIds = new Set(round.options.map((option) => option.id));
  for (const optionId of optionIds ?? []) {
    if (!knownIds.has(optionId))
      addIssue(context, [...path, 'optionIds'], `неизвестный ${optionId}`);
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
  return Boolean(rule.hasProperty || rule.missingProperty || rule.optionIds);
}

function addIssue(context: IssueContext, path: (string | number)[], message: string) {
  context.addIssue({ code: 'custom', message, path });
}
