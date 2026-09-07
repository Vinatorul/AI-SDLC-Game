import { describe, expect, it } from 'vitest';
import harborSource from '../../../content/scenarios/harbor-example.json';
import { forecastAction, forecastStage } from './forecast';
import {
  createInitialMetrics,
  createInitialStages,
  evaluateOutcome,
  getAvailableStageChoices,
  getStageAction,
  resolveRound,
} from './resolve';
import { parseScenario } from './scenario-schema';
import type { EngineSnapshot, Scenario } from './types';

const harbor = parseScenario(harborSource);

function initialSnapshot(scenario = harbor): EngineSnapshot {
  return {
    appliedActions: [],
    metrics: createInitialMetrics(scenario.mechanics),
    properties: [],
    stages: createInitialStages(scenario.mechanics),
  };
}

function firstRound(scenario = harbor) {
  const round = scenario.rounds[0];
  if (!round) throw new Error('Нет шаблона хода');
  return round;
}

function actionSource(scenario: Scenario, id = 'pier.secure') {
  const action = scenario.stageActions[id];
  if (!action) throw new Error(`Нет действия ${id}`);
  return action;
}

function firstEventRule(scenario: Scenario) {
  const rule = firstRound(scenario).eventRules[0];
  if (!rule) throw new Error('Нет события');
  return rule;
}

function play(snapshot: EngineSnapshot, id: string, scenario = harbor) {
  const round = { ...firstRound(scenario), number: snapshot.appliedActions.length + 1 };
  const action = getStageAction(scenario.stageActions, id);
  return resolveRound(snapshot, round, action, scenario.mechanics, scenario.stageActions);
}

describe('сценарий с другими этапами, метриками и свойствами', () => {
  it('берёт порядок этапов и метрик из presentation', () => {
    const source = structuredClone(harbor);
    source.presentation.stages.reverse();
    source.presentation.metricOrder.reverse();
    const scenario = parseScenario(source);
    const snapshot = initialSnapshot(scenario);
    const choices = getAvailableStageChoices(
      scenario.stageActions,
      firstRound(scenario).stageChoices,
      snapshot,
    );
    expect(choices.map(({ stage }) => stage)).toEqual(['fleet', 'warehouse', 'pier']);
    expect(Object.keys(snapshot.metrics)).toEqual(['safety', 'reserves', 'readiness']);
  });

  it('создаёт сохранённое начальное состояние и сохраняет порядок этапов', () => {
    const scenario = structuredClone(harbor);
    scenario.mechanics.initialStages.warehouse = 'AI_ENABLED';
    const snapshot = initialSnapshot(scenario);
    expect(snapshot.metrics).toEqual({ readiness: 1, reserves: 3, safety: 2 });
    expect(snapshot.stages).toEqual({ pier: 'AS_IS', warehouse: 'AI_ENABLED', fleet: 'AS_IS' });
    const choices = getAvailableStageChoices(
      scenario.stageActions,
      [...firstRound(scenario).stageChoices].reverse(),
      snapshot,
    );
    expect(choices.map(({ stage }) => stage)).toEqual(['pier', 'warehouse', 'fleet']);
    snapshot.stages.warehouse = 'BROKEN';
    expect(scenario.mechanics.initialStages.warehouse).toBe('AI_ENABLED');
  });

  it('считает эффекты нового свойства и состояний по новым метрикам', () => {
    const scenario = structuredClone(harbor);
    scenario.mechanics.propertyEffects.spares = { safety: 1 };
    scenario.mechanics.propertyEffectReasons = { spares: { safety: 'Детали есть на складе.' } };
    scenario.mechanics.stageStateEffects = { AI_ENABLED: { readiness: 1 }, AS_IS: {}, BROKEN: {} };
    scenario.mechanics.stageStateEffectReasons = {
      AI_ENABLED: { readiness: 'Участок подготовлен.' },
    };
    const plan = play(initialSnapshot(scenario), 'warehouse.stock', parseScenario(scenario));
    expect(plan.metrics).toEqual({ readiness: 2, reserves: 4, safety: 3 });
    expect(plan.properties).toEqual(['spares']);
    expect(plan.breakdown.properties).toEqual({ readiness: 0, reserves: 0, safety: 1 });
    expect(plan.effectContributions).toContainEqual({
      kind: 'PROPERTY',
      property: 'spares',
      effect: { safety: 1 },
      effectReasons: { safety: 'Детали есть на складе.' },
    });
    expect(plan.effectContributions).toContainEqual({
      kind: 'STAGE_STATE',
      stage: 'warehouse',
      state: 'AI_ENABLED',
      effect: { readiness: 1 },
      effectReasons: { readiness: 'Участок подготовлен.' },
    });
  });

  it('применяет подготовку, ремонт и условие победы без названий SDLC', () => {
    const waiting = play(initialSnapshot(), 'fleet.refit');
    expect(waiting.event.id).toBe('fleet-awaits-parts');
    expect(waiting.stages.fleet).toBe('AS_IS');
    const stocked = play(waiting, 'warehouse.stock');
    expect(stocked.activatedActions).toEqual([
      { actionId: 'fleet.refit', completedByActionId: 'warehouse.stock', stage: 'fleet' },
    ]);
    const damaged = play(stocked, 'pier.rush');
    expect(damaged.stages.pier).toBe('BROKEN');
    expect(evaluateOutcome(damaged.metrics, damaged.stages, 3, harbor.rules).phase).toBe(
      'FEEDBACK',
    );
    const repaired = play(damaged, 'pier.secure');
    expect(evaluateOutcome(repaired.metrics, repaired.stages, 4, harbor.rules).phase).toBe('WON');
    const critical = { ...repaired.metrics, safety: -4 };
    expect(evaluateOutcome(critical, repaired.stages, 4, harbor.rules)).toEqual({
      phase: 'BROKEN',
      reason: 'CRITICAL_METRIC',
    });
  });

  it('блокирует положительную новую метрику и сохраняет отрицательный эффект', () => {
    const scenario = structuredClone(harbor);
    actionSource(scenario, 'pier.rush').effect = { readiness: 2, reserves: -1 };
    actionSource(scenario, 'pier.rush').effectReasons = {
      readiness: 'Судно приняли раньше.',
      reserves: 'Потратили материалы.',
    };
    const plan = play(initialSnapshot(scenario), 'pier.rush', parseScenario(scenario));
    expect(plan.metrics).toEqual({ readiness: 1, reserves: 1, safety: 0 });
    expect(plan.effectContributions).toContainEqual(
      expect.objectContaining({
        kind: 'DECISION',
        effect: { reserves: -1 },
        blockedEffect: { readiness: 2 },
        blockedByStages: { readiness: ['pier'] },
      }),
    );
  });

  it('строит прогноз условной ветки и диапазоны только новых метрик', () => {
    const snapshot = initialSnapshot();
    const round = firstRound();
    const action = getStageAction(harbor.stageActions, 'fleet.refit');
    const forecast = forecastAction(snapshot, round, action, harbor.mechanics, harbor.stageActions);
    expect(forecast.metricDelta).toEqual(play(snapshot, action.id).breakdown.applied);
    expect(forecast.eventBranches).toContainEqual(
      expect.objectContaining({
        eventId: 'fleet-awaits-parts',
        influence: 'WORSENS',
        matched: true,
        selected: true,
      }),
    );
    const choice = round.stageChoices.find(({ stage }) => stage === 'fleet');
    if (!choice) throw new Error('Нет флота');
    const stage = forecastStage(snapshot, round, choice, harbor.mechanics, harbor.stageActions);
    expect(stage.metricRanges).toEqual({
      readiness: { minimum: 0, maximum: 0 },
      reserves: { minimum: 0, maximum: 0 },
      safety: { minimum: 0, maximum: 0 },
    });
  });

  it('учитывает в прогнозе зависимость новой метрики от другого участка', () => {
    const scenario = structuredClone(harbor);
    scenario.mechanics.positiveEffectRequirements = {
      requireActionStage: true,
      additionalStages: { readiness: { pier: ['fleet'] } },
    };
    const snapshot = initialSnapshot(scenario);
    snapshot.stages.fleet = 'BROKEN';
    const action = getStageAction(scenario.stageActions, 'pier.secure');
    const forecast = forecastAction(
      snapshot,
      firstRound(scenario),
      action,
      scenario.mechanics,
      scenario.stageActions,
    );
    expect(forecast.metricDelta).toEqual({ readiness: 0, reserves: -1, safety: 0 });
    expect(forecast.positiveEffectRequirements).toContainEqual({
      metric: 'readiness',
      stage: 'fleet',
      satisfied: false,
    });
  });
});

type InvalidCase = { name: string; path: RegExp; change: (scenario: Scenario) => void };

const invalidCases: InvalidCase[] = [
  {
    name: 'этап события',
    path: /event\.stageChanges/,
    change: (source) => {
      firstEventRule(source).event.stageChanges = [{ stage: 'channel', state: 'AS_IS' }];
    },
  },
  {
    name: 'свойство события',
    path: /event\.addProperties/,
    change: (source) => {
      firstEventRule(source).event.addProperties = ['tools'];
    },
  },
  {
    name: 'метрику повторного эффекта',
    path: /repeatEffect/,
    change: (source) => {
      actionSource(source).repeatEffect = { tide: 1 };
    },
  },
  {
    name: 'этап отсчёта истории',
    path: /stageActionCountsSinceLast/,
    change: (source) => {
      firstEventRule(source).stageActionCountsSinceLast = [
        { stage: 'pier', sinceStage: 'channel', minimum: 1 },
      ];
    },
  },
  {
    name: 'этап действия',
    path: /stageActions\.pier\.secure\.stage/,
    change: (source) => {
      actionSource(source).stage = 'channel';
    },
  },
  {
    name: 'свойство действия',
    path: /addProperties/,
    change: (source) => {
      actionSource(source).addProperties = ['tools'];
    },
  },
  {
    name: 'метрику действия',
    path: /stageActions\.pier\.secure\.effect/,
    change: (source) => {
      actionSource(source).effect.tide = 1;
    },
  },
  {
    name: 'свойство условия',
    path: /hasProperty/,
    change: (source) => {
      firstEventRule(source).hasProperty = 'tools';
    },
  },
  {
    name: 'порядок метрик',
    path: /presentation\.metricOrder/,
    change: (source) => {
      source.presentation.metricOrder.push('tide');
    },
  },
  {
    name: 'определение метрики',
    path: /mechanics\.metricDefinitions/,
    change: (source) => {
      delete source.mechanics.metricDefinitions.safety;
    },
  },
  {
    name: 'подпись этапа',
    path: /presentation\.stages/,
    change: (source) => {
      source.presentation.stages.pop();
    },
  },
  {
    name: 'порог числа этапов',
    path: /minReadyStagesToWin/,
    change: (source) => {
      source.rules.minReadyStagesToWin = 4;
    },
  },
  {
    name: 'метрику зависимости',
    path: /additionalStages/,
    change: (source) => {
      source.mechanics.positiveEffectRequirements = {
        requireActionStage: true,
        additionalStages: { tide: { pier: ['fleet'] } },
      };
    },
  },
  {
    name: 'этап зависимости',
    path: /additionalStages/,
    change: (source) => {
      source.mechanics.positiveEffectRequirements = {
        requireActionStage: true,
        additionalStages: { readiness: { pier: ['channel'] } },
      };
    },
  },
];

describe('проверка ссылок нового сценария', () => {
  it.each(invalidCases)('отклоняет неизвестный или несогласованный $name', ({ change, path }) => {
    const source = structuredClone(harbor);
    change(source);
    expect(() => parseScenario(source)).toThrow(path);
  });

  it.each(['__proto__', 'constructor', 'prototype'])('отклоняет служебный id %s', (id) => {
    const source = structuredClone(harbor);
    source.presentation.stages[0] = { id, label: 'Причал' };
    expect(() => parseScenario(source)).toThrow(/presentation\.stages\.0\.id/);
  });

  it.each([
    '__proto__',
    'constructor',
    'prototype',
  ])('отклоняет служебный ключ каталога %s', (id) => {
    const source = structuredClone(harbor);
    source.stageActions = Object.fromEntries([[id, actionSource(source)]]);
    expect(() => parseScenario(source)).toThrow(/stageActions/);
  });

  it('не принимает унаследованное имя за действие из каталога', () => {
    const source = structuredClone(harbor);
    const choice = firstRound(source).stageChoices[0];
    if (!choice) throw new Error('Нет участка');
    choice.actionIds = ['toString'];
    actionSource(source).recovery = {
      hostHint: 'Замените крепление.',
      repairActionIds: ['toString'],
    };
    expect(() => parseScenario(source)).toThrow(/неизвестный toString/);
  });

  it('принимает один этап, одну метрику и отсутствие свойств', () => {
    const source = structuredClone(harbor);
    source.mechanics.initialStages = { pier: 'AS_IS' };
    source.mechanics.initialMetrics = { readiness: 0 };
    const definition = source.mechanics.metricDefinitions.readiness;
    if (!definition) throw new Error('Нет определения метрики');
    source.mechanics.metricDefinitions = { readiness: definition };
    source.presentation.stages = [{ id: 'pier', label: 'Причал' }];
    source.presentation.metricOrder = ['readiness'];
    source.presentation.properties = [];
    source.mechanics.propertyEffects = {};
    source.rules.minReadyStagesToWin = 1;
    const action = actionSource(source);
    action.effect = { readiness: 1 };
    action.effectReasons = { readiness: 'Суда закреплены.' };
    source.stageActions = { 'pier.secure': action };
    const round = firstRound(source);
    round.stageChoices = [{ stage: 'pier', description: 'Швартовка', actionIds: ['pier.secure'] }];
    round.eventRules = round.eventRules.slice(-1);
    const scenario = parseScenario(source);
    const plan = play(initialSnapshot(scenario), 'pier.secure', scenario);
    expect(plan.metrics).toEqual({ readiness: 1 });
    expect(evaluateOutcome(plan.metrics, plan.stages, 1, scenario.rules).phase).toBe('WON');
  });
});
