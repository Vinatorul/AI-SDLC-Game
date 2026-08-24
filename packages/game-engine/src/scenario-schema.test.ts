import { describe, expect, it } from 'vitest';
import { defaultScenario } from './scenario';
import { parseScenario } from './scenario-schema';

describe('parseScenario', () => {
  it('принимает встроенный JSON-сценарий', () => {
    expect(parseScenario(defaultScenario)).toEqual(defaultScenario);
  });

  it('проверяет соответствие числа раундов правилу', () => {
    const source = structuredClone(defaultScenario);
    source.rules.roundLimit = 4;
    expect(() => parseScenario(source)).toThrow(/rules\.roundLimit.*числом раундов/);
  });

  it('показывает путь до неизвестной ссылки на вариант', () => {
    const source = structuredClone(defaultScenario);
    const firstRule = source.rounds[0]?.eventRules[0];
    if (!firstRule) throw new Error('Тестовый сценарий повреждён');
    firstRule.optionIds = ['missing-option'];
    expect(() => parseScenario(source)).toThrow(/rounds\.0\.eventRules\.0\.optionIds/);
  });

  it('проверяет границы начальных показателей', () => {
    const source = structuredClone(defaultScenario);
    source.mechanics.initialMetrics.quality = 101;
    expect(() => parseScenario(source)).toThrow(/mechanics\.initialMetrics\.quality/);
  });
});
