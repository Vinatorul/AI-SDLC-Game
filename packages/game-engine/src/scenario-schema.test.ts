import { stageKeys } from '@ai-sdlc/contracts';
import { describe, expect, it } from 'vitest';
import { defaultScenario } from './scenario';
import { parseScenario } from './scenario-schema';

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

  it('даёт реальный выбор в бизнес-заказе и продуктовой проработке', () => {
    const choices = defaultScenario.rounds[0]?.stageChoices;
    expect(choices?.find(({ stage }) => stage === 'businessRequest')?.actionIds).toHaveLength(2);
    expect(choices?.find(({ stage }) => stage === 'productDiscovery')?.actionIds).toHaveLength(2);
  });

  it('показывает в заголовке роль AI и человеческую границу', () => {
    const autonomous = new Set([
      'coding.change-from-description',
      'coding.parallel-agents',
      'deployment.autonomous-after-tests',
      'support.autonomous-fix',
    ]);
    for (const [id, action] of Object.entries(defaultScenario.stageActions)) {
      expect(action.title, id).toContain('AI');
      if (!autonomous.has(id)) expect(action.title, id).toContain('—');
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

  it('не превращает скорость написания кода в ускорение TTM', () => {
    expect(defaultScenario.mechanics.propertyEffects.automatedTests.deliverySpeed).toBeUndefined();
    expect(defaultScenario.mechanics.propertyEffects.currentContext.deliverySpeed).toBeUndefined();
    const codingActions = Object.values(defaultScenario.stageActions).filter(
      ({ stage }) => stage === 'coding',
    );
    expect(codingActions.every(({ effect }) => effect.deliverySpeed === undefined)).toBe(true);
  });
});
