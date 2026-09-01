import type {
  EffectBreakdown,
  GameState,
  MetricDefinition,
  MetricDefinitions,
  RoundView,
} from '@ai-sdlc/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MetricChangeNotes } from './MetricChangeNotes';

describe('MetricChangeNotes', () => {
  it('объясняет каждый вклад, даже если они погасили друг друга', () => {
    const state = gameState({
      effectBreakdown: breakdown({ deliverySpeed: -1, quality: 0 }),
      effectContributions: [
        {
          description: 'Проверили результат.',
          effect: { quality: 2 },
          effectReasons: { quality: 'Ревьюер проверил рискованное место.' },
          kind: 'DECISION',
          title: 'Проверка',
        },
        {
          description: 'Нашли ошибку.',
          effect: { quality: -2 },
          effectReasons: { quality: 'Ошибка сломала важный сценарий.' },
          kind: 'EVENT',
          title: 'Ошибка',
        },
        {
          effect: { deliverySpeed: -1 },
          effectReasons: { deliverySpeed: 'Сломанные тесты задержали релиз.' },
          kind: 'STAGE_STATE',
          stage: 'testing',
          state: 'BROKEN',
        },
      ],
    });
    const html = renderToStaticMarkup(<MetricChangeNotes state={state} />);
    expect(html).toContain('Откуда взялись баллы');
    expect(html).toContain('TTM');
    expect(html).toContain('Тестирование: Сломано');
    expect(html).toContain('Сломанные тесты задержали релиз.');
    expect(html).toContain('Качество и стабильность');
    expect(html).toContain('Итого: без изменений');
    expect(html).toContain('Выбрали: Проверка');
    expect(html).toContain('Событие: Ошибка');
    expect(html).toContain('Ревьюер проверил рискованное место.');
    expect(html).not.toContain('Баланс Run / Change');
  });

  it('поддерживает сохранённый breakdown без новых источников', () => {
    const legacyBreakdown = breakdown({ deliverySpeed: -1 });
    delete legacyBreakdown.applied;
    const state = gameState({
      effectBreakdown: legacyBreakdown,
      event: { description: 'Очередь выросла.', evidence: 'SCENARIO', id: 'e1', title: 'Очередь' },
      options: [
        {
          description: 'Проверяем руками.',
          evidence: 'SCENARIO',
          id: 'a1',
          key: 'A',
          shortFeedback: 'Риск заметили.',
          stage: 'review',
          title: 'Ручная проверка',
        },
      ],
      selectedOptionId: 'a1',
    });
    const html = renderToStaticMarkup(<MetricChangeNotes state={state} />);
    expect(html).toContain('Выбрали: Ручная проверка');
    expect(html).toContain('Событие: Очередь');
    expect(html).toContain('Этапы SDLC');
    expect(html).toContain('Расчёт: -1');
    expect(html).not.toContain('Итого: -1');
  });

  it('показывает ведущему бонус, который не прошёл через сломанный этап', () => {
    const state = gameState({
      effectBreakdown: breakdown({ deliverySpeed: 0 }),
      effectContributions: [
        {
          blockedByStages: { deliverySpeed: ['coding', 'review'] },
          blockedEffect: { deliverySpeed: 1 },
          description: 'Инженер проверил план.',
          effect: {},
          effectReasons: { deliverySpeed: 'Разбор кода занял меньше времени.' },
          kind: 'DECISION',
          title: 'Проверить план по коду',
        },
      ],
    });
    const html = renderToStaticMarkup(<MetricChangeNotes state={state} />);
    expect(html).toContain('Не засчитали: Проверить план по коду');
    expect(html).toContain('не начислено');
    expect(html).toContain('Разбор кода занял меньше времени.');
    expect(html).toContain('Сломаны этапы «Написание кода» и «Ревью»');
    expect(html).toContain('+1 к метрике «TTM» не начислили');
  });

  it('ничего не показывает до применения последствий', () => {
    const html = renderToStaticMarkup(<MetricChangeNotes state={gameState({})} />);
    expect(html).toBe('');
  });
});

function gameState(round: Partial<RoundView>): GameState {
  return {
    currentRound: {
      effectBreakdown: null,
      event: null,
      id: 'round-1',
      metricImpact: null,
      number: 1,
      options: [],
      selectedOptionId: null,
      situation: 'Ситуация',
      tiedOptionIds: [],
      title: 'Ход',
      voteTallies: [],
      ...round,
    },
    metricBounds: { maximum: 10, minimum: -10 },
    metricDefinitions,
  } as GameState;
}

function breakdown(total: Record<string, number>): EffectBreakdown {
  return {
    applied: total,
    decision: { deliverySpeed: 1 },
    event: { deliverySpeed: -1 },
    pipeline: { deliverySpeed: -1 },
    properties: {},
    total,
  };
}

const metricDefinitions: MetricDefinitions = {
  controllability: definition('Предсказуемость результата'),
  deliverySpeed: definition('TTM'),
  quality: definition('Качество и стабильность'),
  teamCapacity: definition('Баланс Run / Change'),
};

function definition(label: string): MetricDefinition {
  return {
    description: label,
    label,
    maximumDescription: 'Максимум',
    maximumLabel: 'Максимум',
    minimumDescription: 'Минимум',
    minimumLabel: 'Минимум',
  };
}
