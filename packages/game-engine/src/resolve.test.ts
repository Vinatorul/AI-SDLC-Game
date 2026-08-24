import { describe, expect, it } from 'vitest';
import {
  createInitialMetrics,
  createInitialStages,
  evaluateOutcome,
  resolveRound,
} from './resolve';
import { defaultRules, defaultScenario } from './scenario';

describe('resolveRound', () => {
  it('складывает эффекты и меняет карту детерминированно', () => {
    const round = defaultScenario.rounds[0];
    const option = round?.options.find((item) => item.id === 'r1-c');
    if (!round || !option) throw new Error('Тестовый сценарий повреждён');
    const plan = resolveRound(
      { metrics: createInitialMetrics(), properties: [], stages: createInitialStages() },
      round,
      option,
    );
    expect(plan.metrics).toMatchObject({ deliverySpeed: 72, quality: 54, teamCapacity: 57 });
    expect(plan.stages.coding).toBe('AI_ENABLED');
    expect(plan.stages.review).toBe('BROKEN');
    expect(plan.stages.testing).toBe('BROKEN');
  });

  it('выбирает событие по ранее приобретённому свойству', () => {
    const round = defaultScenario.rounds[1];
    const option = round?.options[1];
    if (!round || !option) throw new Error('Тестовый сценарий повреждён');
    const base = { metrics: createInitialMetrics(), stages: createInitialStages() };
    const risky = resolveRound({ ...base, properties: [] }, round, option);
    const protectedPlan = resolveRound({ ...base, properties: ['currentContext'] }, round, option);
    expect(risky.event.id).toBe('event-2-risk');
    expect(protectedPlan.event.id).toBe('event-2-safe');
  });
});

describe('evaluateOutcome', () => {
  it('считает 15 критическим, а 16 рабочим значением', () => {
    const stages = createInitialStages();
    const critical = { ...createInitialMetrics(), quality: 15 };
    const safe = { ...createInitialMetrics(), quality: 16 };
    expect(evaluateOutcome(critical, stages, 1, defaultRules).reason).toBe('CRITICAL_METRIC');
    expect(evaluateOutcome(safe, stages, 1, defaultRules).phase).toBe('FEEDBACK');
  });

  it('даёт победу после пяти раундов и трёх AI-этапов', () => {
    const stages = createInitialStages();
    stages.coding = 'AI_ENABLED';
    stages.review = 'AI_ENABLED';
    stages.testing = 'AI_ENABLED';
    expect(evaluateOutcome(createInitialMetrics(), stages, 5, defaultRules)).toEqual({
      phase: 'WON',
      reason: null,
    });
  });
});
