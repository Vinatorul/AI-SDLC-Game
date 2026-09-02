import { stageKeys } from '@ai-sdlc/contracts';
import { describe, expect, it } from 'vitest';
import { defaultScenario } from './scenario';
import { parseScenario } from './scenario-schema';

const processActionIds = new Set([
  'businessRequest.outcome-metrics',
  'productDiscovery.knowledge-base',
  'technicalDiscovery.dependency-map',
  'coding.project-checks',
  'review.risk-policy',
  'testing.behavior-checks',
  'deployment.rollback-drill',
  'support.telemetry-baseline',
]);

const processStageTransitions = {
  AI_ENABLED: 'AI_ENABLED',
  AS_IS: 'AS_IS',
  BROKEN: 'AS_IS',
} as const;

function scenarioWithNeutralFirstEvent() {
  const source = structuredClone(defaultScenario);
  const event = source.rounds[0]?.eventRules[0]?.event;
  if (!event) throw new Error('В тестовом сценарии нет события');
  event.effect = {};
  event.effectReasons = undefined;
  event.repeatEffect = undefined;
  event.repeatEffectReasons = undefined;
  event.removeProperties = undefined;
  event.stageChanges = [];
  delete event.recovery;
  return { event, source };
}

describe('parseScenario', () => {
  it('принимает встроенный JSON-сценарий', () => {
    expect(parseScenario(defaultScenario)).toEqual(defaultScenario);
  });

  it('даёт выбрать любой из восьми этапов в каждом раунде', () => {
    expect(defaultScenario.rounds).toHaveLength(1);
    for (const round of defaultScenario.rounds) {
      expect(round.stageChoices).toHaveLength(stageKeys.length);
      expect(round.stageChoices.map(({ stage }) => stage).sort()).toEqual([...stageKeys].sort());
      expect(round.stageChoices.every(({ actionIds }) => actionIds.length >= 1)).toBe(true);
    }
  });

  it('включает перемешивание решений в основном сценарии', () => {
    expect(defaultScenario.rules.shuffleActionChoices).toBe(true);
  });

  it('задаёт обычное событие для каждого действия', () => {
    const round = defaultScenario.rounds[0];
    if (!round) throw new Error('Нет шаблона хода');
    const expected = round.stageChoices.flatMap(({ actionIds }) => actionIds).sort();
    const covered = round.eventRules
      .flatMap(({ actionIds, event: _, ...conditions }) =>
        actionIds && Object.keys(conditions).length === 0 ? actionIds : [],
      )
      .sort();
    expect(covered).toEqual(expected);
  });

  it('использует свойства как защиту, а не как постоянный доход', () => {
    for (const [property, effect] of Object.entries(defaultScenario.mechanics.propertyEffects)) {
      expect(effect, property).toEqual({});
    }
  });

  it('ограничивает обычную награду события одним положительным баллом', () => {
    const round = defaultScenario.rounds[0];
    if (!round) throw new Error('Нет шаблона хода');
    const ordinaryRules = round.eventRules.filter(
      ({ actionIds, event: _, ...conditions }) => actionIds && Object.keys(conditions).length === 0,
    );
    for (const rule of ordinaryRules) {
      const reward = Object.values(rule.event.effect).reduce(
        (sum, value) => sum + Math.max(0, value ?? 0),
        0,
      );
      expect(reward, rule.event.id).toBeLessThanOrEqual(1);
    }
  });

  it('даёт реальный выбор в бизнесе, продукте и кодинге', () => {
    const choices = defaultScenario.rounds[0]?.stageChoices;
    expect(choices?.find(({ stage }) => stage === 'businessRequest')?.actionIds).toHaveLength(4);
    expect(choices?.find(({ stage }) => stage === 'productDiscovery')?.actionIds).toHaveLength(4);
    expect(choices?.find(({ stage }) => stage === 'coding')?.actionIds).toHaveLength(5);
  });

  it('отличает укрепление процесса от работающего AI-внедрения', () => {
    for (const [id, action] of Object.entries(defaultScenario.stageActions)) {
      if (processActionIds.has(id)) {
        expect(action.stageTransitions, id).toEqual(processStageTransitions);
        expect(action.availableInStates, id).toEqual(['AS_IS', 'AI_ENABLED', 'BROKEN']);
        expect(action.effect, id).toEqual({});
        continue;
      }
      expect(action.resultingStageState, id).toBe('AI_ENABLED');
      expect(action.stageTransitions, id).toBeUndefined();
      expect(action.title, id).toContain('AI');
    }
  });

  it('объясняет событием каждую недостающую основу AI-инструмента', () => {
    const rules = defaultScenario.rounds.flatMap(({ eventRules }) => eventRules);
    for (const [id, action] of Object.entries(defaultScenario.stageActions)) {
      if (!action.activationRequirements) continue;
      const covered = rules
        .filter(({ actionIds }) => actionIds?.includes(id))
        .flatMap(({ missingAppliedActions }) => missingAppliedActions ?? []);
      expect(new Set(covered), id).toEqual(new Set(action.activationRequirements));
    }
  });

  it('учитывает изменения кода после последней технической проработки', () => {
    const rule = defaultScenario.rounds[0]?.eventRules.find(
      ({ event }) => event.id === 'event-code-without-technical-context',
    );
    expect(rule?.stageActionCountsSinceLast).toEqual([
      {
        actionIds: [
          'coding.guided-implementation',
          'coding.change-from-description',
          'coding.parallel-agents',
        ],
        maximum: 1,
        minimum: 1,
        sinceStage: 'technicalDiscovery',
        stage: 'coding',
      },
    ]);
  });

  it('проверяет соответствие числа шаблонов правилу', () => {
    const source = structuredClone(defaultScenario);
    source.rules.roundLimit = 4;
    expect(() => parseScenario(source)).toThrow(/rules\.roundLimit.*числом шаблонов раундов/);
  });

  it('показывает путь до неизвестной ссылки на действие', () => {
    const source = structuredClone(defaultScenario);
    const firstRule = source.rounds[0]?.eventRules[0];
    if (!firstRule) throw new Error('Тестовый сценарий повреждён');
    firstRule.actionIds = ['missing-action'];
    expect(() => parseScenario(source)).toThrow(/rounds\.0\.eventRules\.0\.actionIds/);
  });

  it('не даёт привязать к этапу чужое действие', () => {
    const source = structuredClone(defaultScenario);
    const firstChoice = source.rounds[0]?.stageChoices[0];
    if (!firstChoice) throw new Error('Тестовый сценарий повреждён');
    firstChoice.actionIds = ['coding.guided-implementation'];
    expect(() => parseScenario(source)).toThrow(/coding\.guided-implementation относится/);
  });

  it('не допускает одинаковые метки в одном голосовании', () => {
    const source = structuredClone(defaultScenario);
    const firstKey = source.stageActions['technicalDiscovery.code-research']?.key;
    const secondAction = source.stageActions['technicalDiscovery.sync-docs-and-contract'];
    if (!firstKey || !secondAction) throw new Error('Тестовый сценарий повреждён');
    secondAction.key = firstKey;
    expect(() => parseScenario(source)).toThrow(/key действия должен быть уникальным/);
  });

  it('проверяет ссылки условий на предыдущие действия', () => {
    const source = structuredClone(defaultScenario);
    const firstRule = source.rounds[0]?.eventRules[0];
    if (!firstRule) throw new Error('Тестовый сценарий повреждён');
    firstRule.hasAppliedActions = ['missing-action'];
    expect(() => parseScenario(source)).toThrow(/hasAppliedActions.*missing-action/);
  });

  it('проверяет ссылки в счётчике конкретных действий', () => {
    const source = structuredClone(defaultScenario);
    const firstRule = source.rounds[0]?.eventRules[0];
    if (!firstRule) throw new Error('Тестовый сценарий повреждён');
    firstRule.appliedActionCounts = [{ actionIds: ['missing-action'], minimum: 1 }];
    expect(() => parseScenario(source)).toThrow(/appliedActionCounts.*missing-action/);
  });

  it('проверяет ссылки в требованиях активации', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['businessRequest.feedback-mcp'];
    if (!action) throw new Error('Тестовый сценарий повреждён');
    action.activationRequirements = ['missing-action'];
    expect(() => parseScenario(source)).toThrow(/activationRequirements.*missing-action/);
  });

  it('требует подсказку для действия с отложенной активацией', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action?.activationRequirements) throw new Error('Нет действия с отложенной активацией');
    delete action.recovery;
    expect(() => parseScenario(source)).toThrow(/stageActions.*recovery.*подсказка ведущему/);
  });

  it('требует подсказку для события с негативным последствием', () => {
    const { event, source } = scenarioWithNeutralFirstEvent();
    event.effect = { quality: -1 };
    event.effectReasons = { quality: 'Команда пропустила баг.' };
    expect(() => parseScenario(source)).toThrow(/event\.recovery.*подсказка ведущему/);
  });

  it('требует подсказку для негативного повторного эффекта', () => {
    const { event, source } = scenarioWithNeutralFirstEvent();
    event.repeatEffect = { teamCapacity: -1 };
    event.repeatEffectReasons = { teamCapacity: 'Команда повторила ручную работу.' };
    expect(() => parseScenario(source)).toThrow(/event\.recovery.*подсказка ведущему/);
  });

  it('требует подсказку после удаления свойства процесса', () => {
    const { event, source } = scenarioWithNeutralFirstEvent();
    event.removeProperties = ['automatedTests'];
    expect(() => parseScenario(source)).toThrow(/event\.recovery.*подсказка ведущему/);
  });

  it('требует подсказку после ухудшения состояния этапа', () => {
    const { event, source } = scenarioWithNeutralFirstEvent();
    event.stageChanges = [{ stage: 'testing', state: 'BROKEN' }];
    expect(() => parseScenario(source)).toThrow(/event\.recovery.*подсказка ведущему/);
  });

  it('не принимает подсказку без конкретного действия', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action) throw new Error('В тестовом сценарии нет действия');
    action.recovery = { hostHint: 'Почините тестирование.' };
    expect(() => parseScenario(source)).toThrow(/prerequisiteActionIds или repairActionIds/);
  });

  it('не принимает одно действие как подготовку и ремонт', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action) throw new Error('В тестовом сценарии нет действия');
    action.recovery = {
      hostHint: 'Добавьте рабочие автотесты.',
      prerequisiteActionIds: ['testing.behavior-checks'],
      repairActionIds: ['testing.behavior-checks'],
    };
    expect(() => parseScenario(source)).toThrow(/подготовку и ремонт/);
  });

  it('не принимает повтор действия внутри одной подсказки', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action) throw new Error('В тестовом сценарии нет действия');
    action.recovery = {
      hostHint: 'Добавьте рабочие автотесты.',
      repairActionIds: ['testing.behavior-checks', 'testing.behavior-checks'],
    };
    expect(() => parseScenario(source)).toThrow(/id действия должен быть уникальным/);
  });

  it('проверяет ссылки в подсказке на каталог действий', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action) throw new Error('В тестовом сценарии нет действия');
    action.recovery = { hostHint: 'Почините тестирование.', repairActionIds: ['missing-action'] };
    expect(() => parseScenario(source)).toThrow(/recovery\.repairActionIds.*missing-action/);
  });

  it('не предлагает для ремонта одноразовое действие', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action) throw new Error('В тестовом сценарии нет действия');
    action.recovery = {
      hostHint: 'Повторите проверку с QA.',
      repairActionIds: ['testing.ai-checks-with-qa'],
    };
    expect(() => parseScenario(source)).toThrow(/ремонта должно быть повторяемым/);
  });

  it('предлагает для ремонта действие, доступное на сломанном этапе', () => {
    const source = structuredClone(defaultScenario);
    const repair = source.stageActions['testing.behavior-checks'];
    if (!repair) throw new Error('В тестовом сценарии нет действия ремонта');
    repair.availableInStates = ['AS_IS', 'AI_ENABLED'];
    expect(() => parseScenario(source)).toThrow(/ремонта должно быть доступно на сломанном этапе/);
  });

  it('предлагает для ремонта действие, которое чинит этап', () => {
    const source = structuredClone(defaultScenario);
    const repair = source.stageActions['testing.behavior-checks'];
    if (!repair?.stageTransitions) throw new Error('Нет действия ремонта');
    repair.stageTransitions.BROKEN = 'BROKEN';
    expect(() => parseScenario(source)).toThrow(/ремонта должно возвращать этап/);
  });

  it('предлагает для действия ремонт только на том же этапе', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['testing.test-generation-skill'];
    if (!action) throw new Error('В тестовом сценарии нет действия');
    action.recovery = {
      hostHint: 'Запишите правила ревью.',
      repairActionIds: ['review.risk-policy'],
    };
    expect(() => parseScenario(source)).toThrow(/ремонта должно относиться к тому же этапу/);
  });

  it('разрешает событию назвать ремонт на нескольких этапах', () => {
    const source = structuredClone(defaultScenario);
    const rule = source.rounds[0]?.eventRules[0];
    if (!rule) throw new Error('В тестовом сценарии нет события');
    rule.event.recovery = {
      hostHint: 'Добавьте рабочие автотесты и правила ревью.',
      repairActionIds: ['testing.behavior-checks', 'review.risk-policy'],
    };
    expect(parseScenario(source).rounds[0]?.eventRules[0]?.event.recovery).toBeDefined();
  });

  it('требует ремонт для каждого сломанного событием этапа', () => {
    const { event, source } = scenarioWithNeutralFirstEvent();
    event.stageChanges = [{ stage: 'testing', state: 'BROKEN' }];
    event.recovery = {
      hostHint: 'Почините тестирование.',
      repairActionIds: ['review.risk-policy'],
    };
    expect(() => parseScenario(source)).toThrow(/ремонт для сломанного этапа testing/);
  });

  it('требует отдельную причину для каждого эффекта действия', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['businessRequest.production-signals'];
    if (!action?.effectReasons) throw new Error('В тестовом действии нет причин');
    delete action.effectReasons.quality;
    expect(() => parseScenario(source)).toThrow(/effectReasons.*ненулевого эффекта/);
  });

  it('не принимает пробел вместо причины', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['businessRequest.production-signals'];
    if (!action?.effectReasons) throw new Error('В тестовом действии нет причин');
    action.effectReasons.quality = ' ';
    expect(() => parseScenario(source)).toThrow(/effectReasons\.quality/);
  });

  it('требует отдельную причину для каждого эффекта события', () => {
    const source = structuredClone(defaultScenario);
    const event = source.rounds[0]?.eventRules.find(({ event }) => event.effect.quality)?.event;
    if (!event?.effectReasons) throw new Error('В тестовом событии нет причин');
    delete event.effectReasons.quality;
    expect(() => parseScenario(source)).toThrow(/effectReasons.*ненулевого эффекта/);
  });

  it('сохраняет обратную совместимость без repeatEffect', () => {
    const source = structuredClone(defaultScenario);
    expect(
      parseScenario(source).stageActions['coding.guided-implementation']?.repeatEffect,
    ).toBeUndefined();
  });

  it('требует причины для repeatEffect действия и события', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['businessRequest.production-signals'];
    const event = source.rounds[0]?.eventRules[0]?.event;
    if (!action || !event) throw new Error('В тестовом сценарии нет действия или события');
    action.repeatEffect = { quality: 1 };
    event.repeatEffect = { controllability: -1 };
    expect(() => parseScenario(source)).toThrow(/repeatEffectReasons.*ненулевого эффекта/);
  });

  it('отклоняет повтор свойства и конфликт addProperties с removeProperties', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['businessRequest.production-signals'];
    const event = source.rounds[0]?.eventRules[0]?.event;
    if (!action || !event) throw new Error('В тестовом сценарии нет действия или события');
    action.addProperties = ['humanReview', 'humanReview'];
    event.addProperties = ['rollback'];
    event.removeProperties = ['rollback'];
    expect(() => parseScenario(source)).toThrow(/свойство/);
  });

  it('отклоняет повторяющуюся пару в stageActionCountsSinceLast', () => {
    const source = structuredClone(defaultScenario);
    const rule = source.rounds[0]?.eventRules[0];
    if (!rule) throw new Error('В тестовом сценарии нет правила');
    rule.stageActionCountsSinceLast = [
      { minimum: 1, sinceStage: 'technicalDiscovery', stage: 'coding' },
      { maximum: 2, sinceStage: 'technicalDiscovery', stage: 'coding' },
    ];
    expect(() => parseScenario(source)).toThrow(/stageActionCountsSinceLast.*уникальным/);
  });

  it('проверяет ссылки stageActionCountsSinceLast на каталог действий', () => {
    const source = structuredClone(defaultScenario);
    const rule = source.rounds[0]?.eventRules[0];
    if (!rule) throw new Error('В тестовом сценарии нет правила');
    rule.stageActionCountsSinceLast = [
      {
        actionIds: ['missing-action'],
        minimum: 1,
        sinceStage: 'technicalDiscovery',
        stage: 'coding',
      },
    ];
    expect(() => parseScenario(source)).toThrow(/stageActionCountsSinceLast.*неизвестный/);
  });

  it('не считает в stageActionCountsSinceLast действия другого этапа', () => {
    const source = structuredClone(defaultScenario);
    const rule = source.rounds[0]?.eventRules[0];
    if (!rule) throw new Error('В тестовом сценарии нет правила');
    rule.stageActionCountsSinceLast = [
      {
        actionIds: ['review.risk-policy'],
        minimum: 1,
        sinceStage: 'technicalDiscovery',
        stage: 'coding',
      },
    ];
    expect(() => parseScenario(source)).toThrow(/действие относится к другому этапу/);
  });

  it('проверяет границы начальных показателей', () => {
    const source = structuredClone(defaultScenario);
    source.mechanics.initialMetrics.quality = 11;
    expect(() => parseScenario(source)).toThrow(/mechanics\.initialMetrics\.quality/);
  });

  it('требует, чтобы шкала проходила через ноль', () => {
    const source = structuredClone(defaultScenario);
    source.mechanics.metricBounds = { maximum: 20, minimum: 0 };
    expect(() => parseScenario(source)).toThrow(/metricBounds.*0/);
  });

  it('не принимает пустое описание показателя', () => {
    const source = structuredClone(defaultScenario);
    source.mechanics.metricDefinitions.teamCapacity.minimumDescription = '';
    expect(() => parseScenario(source)).toThrow(/metricDefinitions\.teamCapacity/);
  });

  it('не допускает неизвестное состояние в эффектах этапов', () => {
    const source = structuredClone(defaultScenario);
    const effects = source.mechanics.stageStateEffects as Record<string, unknown>;
    effects.PAUSED = {};
    expect(() => parseScenario(source)).toThrow(/stageStateEffects/);
  });

  it('требует причину для постоянного штрафа сломанных этапов', () => {
    const source = structuredClone(defaultScenario);
    const effects = source.mechanics.stageStateEffects;
    if (!effects) throw new Error('В тестовой механике нет эффектов этапов');
    effects.BROKEN = { deliverySpeed: -1 };
    const reasons = source.mechanics.stageStateEffectReasons;
    if (!reasons) throw new Error('В тестовой механике нет причин');
    reasons.BROKEN = {};
    expect(() => parseScenario(source)).toThrow(/stageStateEffectReasons\.BROKEN/);
  });

  it('не начисляет очки за состояние этапов в основном сценарии', () => {
    expect(defaultScenario.mechanics.stageStateEffects).toEqual({
      AI_ENABLED: {},
      AS_IS: {},
      BROKEN: {},
    });
  });

  it('задаёт этапы, через которые должен пройти положительный TTM', () => {
    const requirements = defaultScenario.mechanics.positiveEffectRequirements;
    expect(requirements?.requireActionStage).toBe(true);
    expect(requirements?.additionalStages?.deliverySpeed?.technicalDiscovery).toEqual([
      'coding',
      'review',
      'testing',
      'deployment',
    ]);
  });

  it('не принимает один этап дважды в требованиях к эффекту', () => {
    const source = structuredClone(defaultScenario);
    const requirements = source.mechanics.positiveEffectRequirements;
    if (!requirements?.additionalStages?.deliverySpeed) throw new Error('Нет требований к TTM');
    requirements.additionalStages.deliverySpeed.coding = ['review', 'review'];
    expect(() => parseScenario(source)).toThrow(/этапы не должны повторяться/);
  });

  it('не требует карты причин, если постоянных поправок нет', () => {
    const source = structuredClone(defaultScenario);
    source.mechanics.stageStateEffects = { AI_ENABLED: {}, AS_IS: {}, BROKEN: {} };
    delete source.mechanics.propertyEffectReasons;
    delete source.mechanics.stageStateEffectReasons;
    expect(parseScenario(source).mechanics.stageStateEffectReasons).toBeUndefined();
  });

  it('проверяет положительный TTM кодинга по следующим этапам', () => {
    expect(defaultScenario.mechanics.propertyEffects.automatedTests.deliverySpeed).toBeUndefined();
    expect(defaultScenario.mechanics.propertyEffects.currentContext.deliverySpeed).toBeUndefined();
    expect(defaultScenario.stageActions['coding.parallel-agents']?.effect.deliverySpeed).toBe(2);
    expect(
      defaultScenario.mechanics.positiveEffectRequirements?.additionalStages?.deliverySpeed?.coding,
    ).toEqual(['review', 'testing', 'deployment']);
  });
});
