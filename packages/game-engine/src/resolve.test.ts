import type { GameRules } from '@ai-sdlc/contracts';
import { describe, expect, it } from 'vitest';
import {
  createInitialMetrics,
  createInitialStages,
  evaluateOutcome,
  resolveRound,
} from './resolve';
import type { EngineOption, ScenarioMechanics, ScenarioRound } from './types';

const mechanics: ScenarioMechanics = {
  initialMetrics: { controllability: 60, deliverySpeed: 60, quality: 60, teamCapacity: 60 },
  metricBounds: { maximum: 100, minimum: 0 },
  propertyEffects: {
    automatedTests: {},
    currentContext: {},
    humanReview: { quality: 2 },
    observability: {},
    rollback: {},
  },
};

const rules: GameRules = {
  criticalThreshold: 15,
  dangerThreshold: 30,
  minAiStagesToWin: 3,
  notableVoteShare: 0.15,
  requireNoBrokenStages: false,
  roundLimit: 5,
};

const option: EngineOption = {
  addProperties: ['humanReview'],
  description: 'Описание решения',
  effect: { deliverySpeed: 12 },
  evidence: 'SCENARIO',
  id: 'option-a',
  key: 'A',
  shortFeedback: 'Обратная связь',
  stage: 'coding',
  stageChanges: [{ stage: 'coding', state: 'AI_ENABLED' }],
  title: 'Решение',
};

const round: ScenarioRound = {
  eventRules: [
    {
      event: {
        description: 'Описание события',
        effect: { quality: -8 },
        evidence: 'SCENARIO',
        id: 'event-selected',
        stageChanges: [{ stage: 'review', state: 'BROKEN' }],
        title: 'Событие',
      },
      optionIds: ['option-a'],
    },
    {
      event: {
        description: 'Резервное событие',
        effect: {},
        evidence: 'SCENARIO',
        id: 'event-fallback',
        stageChanges: [],
        title: 'Резерв',
      },
    },
  ],
  id: 'round-1',
  number: 1,
  options: [option],
  situation: 'Ситуация',
  title: 'Раунд',
};

describe('resolveRound', () => {
  it('складывает эффекты и меняет карту детерминированно', () => {
    const plan = resolveRound(
      { metrics: createInitialMetrics(mechanics), properties: [], stages: createInitialStages() },
      round,
      option,
      mechanics,
    );
    expect(plan.metrics).toMatchObject({ deliverySpeed: 72, quality: 54 });
    expect(plan.stages.coding).toBe('AI_ENABLED');
    expect(plan.stages.review).toBe('BROKEN');
  });

  it('берёт границы и эффекты свойств из сценария', () => {
    const configured = {
      ...mechanics,
      metricBounds: { maximum: 65, minimum: 10 },
      propertyEffects: { ...mechanics.propertyEffects, humanReview: { quality: 20 } },
    };
    const plan = resolveRound(
      { metrics: createInitialMetrics(configured), properties: [], stages: createInitialStages() },
      round,
      option,
      configured,
    );
    expect(plan.metrics).toMatchObject({ deliverySpeed: 65, quality: 65 });
  });
});

describe('evaluateOutcome', () => {
  it('считает 15 критическим, а 16 рабочим значением', () => {
    const stages = createInitialStages();
    const critical = { ...createInitialMetrics(mechanics), quality: 15 };
    const safe = { ...createInitialMetrics(mechanics), quality: 16 };
    expect(evaluateOutcome(critical, stages, 1, rules).reason).toBe('CRITICAL_METRIC');
    expect(evaluateOutcome(safe, stages, 1, rules).phase).toBe('FEEDBACK');
  });

  it('даёт победу после пяти раундов и трёх AI-этапов', () => {
    const stages = createInitialStages();
    stages.coding = 'AI_ENABLED';
    stages.review = 'AI_ENABLED';
    stages.testing = 'AI_ENABLED';
    expect(evaluateOutcome(createInitialMetrics(mechanics), stages, 5, rules)).toEqual({
      phase: 'WON',
      reason: null,
    });
  });
});
