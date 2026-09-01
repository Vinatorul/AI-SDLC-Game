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

  it('связывает поздний долг с повторным кодингом без технической проработки', () => {
    const rule = defaultScenario.rounds[0]?.eventRules.find(
      ({ event }) => event.id === 'event-code-without-technical-context',
    );
    expect(rule?.appliedActionCount).toEqual({ minimum: 6 });
    expect(rule?.stageActionCounts).toEqual(
      expect.arrayContaining([
        { minimum: 2, stage: 'coding' },
        { maximum: 1, stage: 'technicalDiscovery' },
      ]),
    );
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

  it('проверяет ссылки в требованиях активации', () => {
    const source = structuredClone(defaultScenario);
    const action = source.stageActions['businessRequest.feedback-mcp'];
    if (!action) throw new Error('Тестовый сценарий повреждён');
    action.activationRequirements = ['missing-action'];
    expect(() => parseScenario(source)).toThrow(/activationRequirements.*missing-action/);
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
    const event = source.rounds[0]?.eventRules[0]?.event;
    if (!event?.effectReasons) throw new Error('В тестовом событии нет причин');
    delete event.effectReasons.quality;
    expect(() => parseScenario(source)).toThrow(/effectReasons.*ненулевого эффекта/);
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

  it('не превращает скорость написания кода в ускорение TTM', () => {
    expect(defaultScenario.mechanics.propertyEffects.automatedTests.deliverySpeed).toBeUndefined();
    expect(defaultScenario.mechanics.propertyEffects.currentContext.deliverySpeed).toBeUndefined();
    const codingActions = Object.values(defaultScenario.stageActions).filter(
      ({ stage }) => stage === 'coding',
    );
    expect(codingActions.every(({ effect }) => effect.deliverySpeed === undefined)).toBe(true);
  });
});
