import type { MetricDelta, MetricReasons } from '@ai-sdlc/contracts';
import { z } from 'zod';
import { identifierSchema, presentationSchema } from './scenario-presentation-schema';
import type { Scenario } from './types';

const metricDeltaSchema = z.record(identifierSchema, z.number());

const metricReasonsSchema = z.record(identifierSchema, z.string().trim().min(1));

const metricValuesSchema = metricDeltaSchema.refine(
  (values) => Object.keys(values).length > 0,
  'нужна хотя бы одна метрика',
);

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

const metricDefinitionsSchema = z.record(identifierSchema, metricDefinitionSchema);

const propertySchema = identifierSchema;
const stageSchema = identifierSchema;
const stageStateSchema = z.enum(['AS_IS', 'AI_ENABLED', 'BROKEN']);
const requiredStagesSchema = z
  .array(stageSchema)
  .min(1)
  .refine((stages) => new Set(stages).size === stages.length, 'этапы не должны повторяться');
const stageEffectRequirementsSchema = z.record(identifierSchema, requiredStagesSchema);
const additionalRequiredStagesSchema = z.record(identifierSchema, stageEffectRequirementsSchema);
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
const actionIdListSchema = z
  .array(identifierSchema)
  .min(1)
  .refine((ids) => new Set(ids).size === ids.length, 'id действия должен быть уникальным');
const recoveryGuideSchema = z
  .object({
    hostHint: z.string().trim().min(1),
    prerequisiteActionIds: actionIdListSchema.optional(),
    repairActionIds: actionIdListSchema.optional(),
  })
  .strict()
  .refine(
    ({ prerequisiteActionIds, repairActionIds }) =>
      Boolean(prerequisiteActionIds || repairActionIds),
    'нужно указать prerequisiteActionIds или repairActionIds',
  );
const countRangeSchema = z
  .object({
    maximum: z.number().int().min(0).optional(),
    minimum: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((range) => isValidRange(range), 'minimum не должен быть больше maximum');

const appliedActionCountConditionSchema = z
  .object({
    actionIds: z.array(identifierSchema).min(1),
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
    actionIds: z.array(identifierSchema).min(1).optional(),
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
    id: identifierSchema,
    addProperties: z.array(propertySchema).optional(),
    recovery: recoveryGuideSchema.optional(),
    removeProperties: z.array(propertySchema).optional(),
    repeatEffect: metricDeltaSchema.optional(),
    repeatEffectReasons: metricReasonsSchema.optional(),
    stageChanges: z.array(stageMutationSchema),
    title: z.string().min(1),
  })
  .strict();

const eventRuleSchema = z
  .object({
    actionIds: z.array(identifierSchema).min(1).optional(),
    appliedActionCounts: z.array(appliedActionCountConditionSchema).min(1).optional(),
    appliedActionCount: countRangeSchema.optional(),
    event: eventSchema,
    hasAppliedActions: z.array(identifierSchema).min(1).optional(),
    hasProperty: propertySchema.optional(),
    hasResultingProperty: propertySchema.optional(),
    missingAppliedActions: z.array(identifierSchema).min(1).optional(),
    missingProperty: propertySchema.optional(),
    missingResultingProperty: propertySchema.optional(),
    stageActionCounts: z.array(stageActionCountSchema).min(1).optional(),
    stageActionCountsSinceLast: z.array(stageActionCountSinceLastSchema).min(1).optional(),
    stageStates: z.array(stageMutationSchema).min(1).optional(),
  })
  .strict();

const stageActionBaseSchema = z
  .object({
    activationRequirements: z.array(identifierSchema).min(1).optional(),
    addProperties: z.array(propertySchema),
    availableInStates: z.array(stageStateSchema).min(1),
    description: z.string().min(1),
    effect: metricDeltaSchema,
    effectReasons: metricReasonsSchema.optional(),
    evidence: z.enum(['FACT', 'SCENARIO']),
    key: z.string().min(1),
    recovery: recoveryGuideSchema.optional(),
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
    actionIds: z.array(identifierSchema).min(1),
    description: z.string().min(1),
    stage: stageSchema,
    title: z.string().min(1).optional(),
  })
  .strict();

const roundSchema = z
  .object({
    eventRules: z.array(eventRuleSchema).min(1),
    id: identifierSchema,
    number: z.number().int().positive(),
    situation: z.string().min(1),
    stageChoices: z.array(stageChoiceSchema).min(1),
    title: z.string().min(1),
  })
  .strict();

const rulesSchema = z
  .object({
    criticalThreshold: z.number(),
    dangerThreshold: z.number(),
    minReadyStagesToWin: z.number().int().min(0),
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
    initialStages: z
      .record(identifierSchema, stageStateSchema)
      .refine((stages) => Object.keys(stages).length > 0, 'нужен хотя бы один этап'),
    metricBounds: z.object({ maximum: z.number(), minimum: z.number() }).strict(),
    metricDefinitions: metricDefinitionsSchema,
    metricScaleDescription: z.string().min(1),
    positiveEffectRequirements: positiveEffectRequirementsSchema.optional(),
    propertyEffects: z.record(identifierSchema, metricDeltaSchema),
    propertyEffectReasons: z.record(identifierSchema, metricReasonsSchema).optional(),
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
    id: identifierSchema,
    mechanics: mechanicsSchema,
    presentation: presentationSchema,
    rounds: z.array(roundSchema).min(1),
    rules: rulesSchema,
    schemaVersion: z.literal(5),
    stageActions: z.record(identifierSchema, stageActionSchema),
    version: z.number().int().positive(),
  })
  .strict()
  .superRefine(validateScenario);

type ScenarioCandidate = z.infer<typeof scenarioSchema>;
type IssueContext = Parameters<Parameters<typeof scenarioSchema.superRefine>[0]>[1];
type RecoveryCandidate = ScenarioCandidate['stageActions'][string]['recovery'];

export function parseScenario(input: unknown): Scenario {
  const result = scenarioSchema.safeParse(input);
  if (result.success) return orderScenario(result.data);
  const details = result.error.issues
    .map((issue) => `${issue.path.join('.') || 'scenario'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Сценарий не прошёл проверку: ${details}`);
}

function orderScenario(scenario: Scenario): Scenario {
  const { mechanics, presentation } = scenario;
  return {
    ...scenario,
    mechanics: {
      ...mechanics,
      initialStages: orderRecord(
        mechanics.initialStages,
        presentation.stages.map(({ id }) => id),
      ),
      initialMetrics: orderRecord(mechanics.initialMetrics, presentation.metricOrder),
    },
  };
}

function orderRecord<T>(values: Record<string, T>, ids: string[]): Record<string, T> {
  return Object.fromEntries(
    ids.map((id) => {
      const value = values[id];
      if (value === undefined) throw new Error(`Неизвестный идентификатор ${id}`);
      return [id, value];
    }),
  );
}

function validateDefinitions(scenario: ScenarioCandidate, context: IssueContext) {
  const { mechanics, presentation } = scenario;
  const stageIds = Object.keys(mechanics.initialStages);
  validateMatchingKeys(
    presentation.stages.map(({ id }) => id),
    stageIds,
    ['presentation', 'stages'],
    context,
  );
  validateMetricDefinitions(scenario, context);
  validatePropertyDefinitions(scenario, context);
  if (scenario.rules.minReadyStagesToWin > stageIds.length) {
    addIssue(context, ['rules', 'minReadyStagesToWin'], 'не может превышать число этапов');
  }
  validateMechanicReferences(scenario, context);
}

function validateMetricDefinitions(scenario: ScenarioCandidate, context: IssueContext) {
  const { mechanics, presentation } = scenario;
  const metricIds = Object.keys(mechanics.initialMetrics);
  validateMatchingKeys(
    presentation.metricOrder,
    metricIds,
    ['presentation', 'metricOrder'],
    context,
  );
  validateMatchingKeys(
    Object.keys(mechanics.metricDefinitions),
    metricIds,
    ['mechanics', 'metricDefinitions'],
    context,
  );
}

function validatePropertyDefinitions(scenario: ScenarioCandidate, context: IssueContext) {
  const { mechanics, presentation } = scenario;
  const propertyIds = presentation.properties.map(({ id }) => id);
  validateMatchingKeys(
    Object.keys(mechanics.propertyEffects),
    propertyIds,
    ['mechanics', 'propertyEffects'],
    context,
  );
  validateUnique(propertyIds, ['presentation', 'properties'], 'id свойства', context);
}

function validateMatchingKeys(
  actual: string[],
  expected: string[],
  path: (string | number)[],
  context: IssueContext,
) {
  if (new Set(actual).size !== actual.length || !sameKeys(actual, expected)) {
    addIssue(context, path, 'идентификаторы должны совпадать с настройками сценария без повторов');
  }
}

function validateMechanicReferences(scenario: ScenarioCandidate, context: IssueContext) {
  const { mechanics } = scenario;
  const metrics = new Set(Object.keys(mechanics.initialMetrics));
  const properties = new Set(scenario.presentation.properties.map(({ id }) => id));
  validateKnown(
    Object.keys(mechanics.propertyEffectReasons ?? {}),
    properties,
    ['mechanics', 'propertyEffectReasons'],
    context,
  );
  for (const [property, effect] of Object.entries(mechanics.propertyEffects)) {
    validateKnown(
      Object.keys(effect),
      metrics,
      ['mechanics', 'propertyEffects', property],
      context,
    );
  }
  for (const [state, effect] of Object.entries(mechanics.stageStateEffects ?? {})) {
    validateKnown(Object.keys(effect), metrics, ['mechanics', 'stageStateEffects', state], context);
  }
  validatePositiveRequirements(scenario, context);
}

function validatePositiveRequirements(scenario: ScenarioCandidate, context: IssueContext) {
  const stages = new Set(Object.keys(scenario.mechanics.initialStages));
  const metrics = new Set(Object.keys(scenario.mechanics.initialMetrics));
  const requirements = scenario.mechanics.positiveEffectRequirements?.additionalStages ?? {};
  const path = ['mechanics', 'positiveEffectRequirements', 'additionalStages'];
  validateKnown(Object.keys(requirements), metrics, path, context);
  for (const [metric, byStage] of Object.entries(requirements)) {
    validateKnown(Object.keys(byStage), stages, [...path, metric], context);
    for (const [stage, required] of Object.entries(byStage)) {
      validateKnown(required, stages, [...path, metric, stage], context);
    }
  }
}

function validateActionReferences(
  id: string,
  action: ScenarioCandidate['stageActions'][string],
  scenario: ScenarioCandidate,
  context: IssueContext,
) {
  const stages = new Set(Object.keys(scenario.mechanics.initialStages));
  const properties = new Set(scenario.presentation.properties.map(({ id }) => id));
  const path = ['stageActions', id];
  validateKnown([action.stage], stages, [...path, 'stage'], context);
  validateKnown(action.addProperties, properties, [...path, 'addProperties'], context);
  validateEffectReferences(action, scenario, path, context);
}

function validateEffectReferences(
  source: { effect: MetricDelta; repeatEffect?: MetricDelta },
  scenario: ScenarioCandidate,
  path: (string | number)[],
  context: IssueContext,
) {
  const metrics = new Set(Object.keys(scenario.mechanics.initialMetrics));
  validateKnown(Object.keys(source.effect), metrics, [...path, 'effect'], context);
  validateKnown(
    Object.keys(source.repeatEffect ?? {}),
    metrics,
    [...path, 'repeatEffect'],
    context,
  );
}

function validateEventReferences(
  event: ScenarioCandidate['rounds'][number]['eventRules'][number]['event'],
  scenario: ScenarioCandidate,
  path: (string | number)[],
  context: IssueContext,
) {
  const stages = new Set(Object.keys(scenario.mechanics.initialStages));
  const properties = new Set(scenario.presentation.properties.map(({ id }) => id));
  validateKnown(
    event.stageChanges.map(({ stage }) => stage),
    stages,
    [...path, 'stageChanges'],
    context,
  );
  validateKnown(event.addProperties, properties, [...path, 'addProperties'], context);
  validateKnown(event.removeProperties, properties, [...path, 'removeProperties'], context);
  validateEffectReferences(event, scenario, path, context);
}

function validateConditionReferences(
  rule: ScenarioCandidate['rounds'][number]['eventRules'][number],
  scenario: ScenarioCandidate,
  path: (string | number)[],
  context: IssueContext,
) {
  const stages = new Set(Object.keys(scenario.mechanics.initialStages));
  validatePropertyConditions(rule, scenario, path, context);
  validateKnown(
    rule.stageStates?.map(({ stage }) => stage),
    stages,
    [...path, 'stageStates'],
    context,
  );
  validateKnown(
    rule.stageActionCounts?.map(({ stage }) => stage),
    stages,
    [...path, 'stageActionCounts'],
    context,
  );
  const countedStages = rule.stageActionCountsSinceLast?.flatMap(({ stage, sinceStage }) => [
    stage,
    sinceStage,
  ]);
  validateKnown(countedStages, stages, [...path, 'stageActionCountsSinceLast'], context);
}

function validatePropertyConditions(
  rule: ScenarioCandidate['rounds'][number]['eventRules'][number],
  scenario: ScenarioCandidate,
  path: (string | number)[],
  context: IssueContext,
) {
  const properties = new Set(scenario.presentation.properties.map(({ id }) => id));
  for (const key of [
    'hasProperty',
    'missingProperty',
    'hasResultingProperty',
    'missingResultingProperty',
  ] as const) {
    const property = rule[key];
    validateKnown(property ? [property] : [], properties, [...path, key], context);
  }
}

function validateScenario(scenario: ScenarioCandidate, context: IssueContext) {
  validateDefinitions(scenario, context);
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
  for (const [key, value] of Object.entries(scenario.mechanics.initialMetrics)) {
    if (value < minimum || value > maximum) {
      addIssue(context, ['mechanics', 'initialMetrics', key], 'значение вне границ метрики');
    }
  }
  validateThresholds(scenario, context);
  validateMechanicReasons(scenario, context);
}

function validateMechanicReasons(scenario: ScenarioCandidate, context: IssueContext) {
  for (const [property, effect] of Object.entries(scenario.mechanics.propertyEffects)) {
    validateEffectReasons(
      effect,
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
    validateActionReferences(id, action, scenario, context);
    validateAction(id, action, scenario, context);
  });
}

function validateAction(
  id: string,
  action: ScenarioCandidate['stageActions'][string],
  scenario: ScenarioCandidate,
  context: IssueContext,
) {
  validateUnique(
    action.availableInStates,
    ['stageActions', id, 'availableInStates'],
    'состояние',
    context,
  );
  validateActivationRequirements(id, action, scenario, context);
  const recoveryPath = ['stageActions', id, 'recovery'] as (string | number)[];
  validateRequiredRecovery(action.activationRequirements, action.recovery, recoveryPath, context);
  validateRecovery(scenario, action.recovery, recoveryPath, context, action.stage);
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

function validateActivationRequirements(
  id: string,
  action: ScenarioCandidate['stageActions'][string],
  scenario: ScenarioCandidate,
  context: IssueContext,
) {
  const path = ['stageActions', id, 'activationRequirements'] as (string | number)[];
  validateUnique(action.activationRequirements ?? [], path, 'требование активации', context);
  validateKnown(
    action.activationRequirements,
    new Set(Object.keys(scenario.stageActions)),
    path,
    context,
  );
  if (action.activationRequirements?.includes(id)) {
    addIssue(context, path, 'не должно ссылаться на себя');
  }
  if (
    action.activationRequirements &&
    (!('resultingStageState' in action) || action.resultingStageState !== 'AI_ENABLED')
  ) {
    addIssue(context, path, 'допустимо только для действия с результатом AI_ENABLED');
  }
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
  validateKnown(
    [choice.stage],
    new Set(Object.keys(scenario.mechanics.initialStages)),
    [...path, 'stage'],
    context,
  );
  validateUnique(choice.actionIds, [...path, 'actionIds'], 'id действия', context);
  for (const actionId of choice.actionIds) {
    const action = knownAction(scenario, actionId);
    if (!action) addIssue(context, [...path, 'actionIds'], `неизвестный ${actionId}`);
    else if (action.stage !== choice.stage) {
      addIssue(context, [...path, 'actionIds'], `${actionId} относится к другому этапу`);
    }
  }
  const keys = choice.actionIds.flatMap((id) => knownAction(scenario, id)?.key ?? []);
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
    const recoveryPath = [...path, 'event', 'recovery'];
    validateAdverseEventRecovery(rule.event, recoveryPath, context);
    validateRecovery(scenario, rule.event.recovery, recoveryPath, context);
    validateBrokenStageRepairs(scenario, rule.event, recoveryPath, context);
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

function validateRequiredRecovery(
  requirement: unknown,
  recovery: RecoveryCandidate,
  path: (string | number)[],
  context: IssueContext,
) {
  if (requirement && !recovery) {
    addIssue(context, path, 'нужна подсказка ведущему с конкретными действиями');
  }
}

function validateAdverseEventRecovery(
  event: ScenarioCandidate['rounds'][number]['eventRules'][number]['event'],
  path: (string | number)[],
  context: IssueContext,
) {
  const changesStage = event.stageChanges.some(({ state }) => state !== 'AI_ENABLED');
  const removesProperty = Boolean(event.removeProperties?.length);
  const lowersMetric = hasNegativeMetric(event.effect) || hasNegativeMetric(event.repeatEffect);
  validateRequiredRecovery(
    changesStage || removesProperty || lowersMetric,
    event.recovery,
    path,
    context,
  );
}

function validateRecovery(
  scenario: ScenarioCandidate,
  recovery: RecoveryCandidate,
  path: (string | number)[],
  context: IssueContext,
  expectedStage?: ScenarioCandidate['stageActions'][string]['stage'],
) {
  if (!recovery) return;
  const known = new Set(Object.keys(scenario.stageActions));
  validateKnown(recovery.prerequisiteActionIds, known, [...path, 'prerequisiteActionIds'], context);
  validateKnown(recovery.repairActionIds, known, [...path, 'repairActionIds'], context);
  const prerequisites = new Set(recovery.prerequisiteActionIds ?? []);
  if (recovery.repairActionIds?.some((id) => prerequisites.has(id))) {
    addIssue(context, path, 'одно действие нельзя указать как подготовку и ремонт');
  }
  recovery.repairActionIds?.forEach((id, index) => {
    validateRepairAction(scenario, id, [...path, 'repairActionIds', index], context, expectedStage);
  });
}

function validateRepairAction(
  scenario: ScenarioCandidate,
  id: string,
  path: (string | number)[],
  context: IssueContext,
  expectedStage?: ScenarioCandidate['stageActions'][string]['stage'],
) {
  const action = knownAction(scenario, id);
  if (!action) return;
  if (!action.repeatable) addIssue(context, path, 'действие ремонта должно быть повторяемым');
  if (!action.availableInStates.includes('BROKEN')) {
    addIssue(context, path, 'действие ремонта должно быть доступно на сломанном этапе');
  }
  if (brokenResult(action) === 'BROKEN') {
    addIssue(context, path, 'действие ремонта должно возвращать этап в рабочее состояние');
  }
  if (expectedStage && action.stage !== expectedStage) {
    addIssue(context, path, 'действие ремонта должно относиться к тому же этапу');
  }
}

function validateBrokenStageRepairs(
  scenario: ScenarioCandidate,
  event: ScenarioCandidate['rounds'][number]['eventRules'][number]['event'],
  path: (string | number)[],
  context: IssueContext,
) {
  const repairStages = new Set(
    event.recovery?.repairActionIds?.map((id) => knownAction(scenario, id)?.stage),
  );
  for (const { stage, state } of event.stageChanges) {
    if (state === 'BROKEN' && !repairStages.has(stage)) {
      addIssue(context, path, `нужно указать ремонт для сломанного этапа ${stage}`);
    }
  }
}

function brokenResult(action: ScenarioCandidate['stageActions'][string]) {
  return 'stageTransitions' in action ? action.stageTransitions.BROKEN : action.resultingStageState;
}

function hasNegativeMetric(effect: MetricDelta | undefined) {
  return Object.values(effect ?? {}).some((value) => (value ?? 0) < 0);
}

function knownAction(scenario: ScenarioCandidate, id: string) {
  return Object.hasOwn(scenario.stageActions, id) ? scenario.stageActions[id] : undefined;
}

function validateEffectReasons(
  effect: MetricDelta,
  reasons: MetricReasons | undefined,
  path: (string | number)[],
  context: IssueContext,
) {
  const effectKeys = Object.keys(effect).filter((key) => effect[key] !== 0);
  const reasonKeys = Object.keys(reasons ?? {});
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
  validateConditionReferences(rule, scenario, path, context);
  validateEventReferences(rule.event, scenario, [...path, 'event'], context);
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
