import type {
  EvidenceKind,
  GameRules,
  MetricDelta,
  ProcessProperty,
  StageKey,
  StageMutation,
} from '@ai-sdlc/contracts';
import type { EngineEvent, EngineOption, EventRule, Scenario, ScenarioRound } from './types';

export const defaultRules: GameRules = {
  criticalThreshold: 15,
  dangerThreshold: 30,
  minAiStagesToWin: 3,
  notableVoteShare: 0.15,
  requireNoBrokenStages: false,
  roundLimit: 5,
};

const rounds: ScenarioRound[] = [
  {
    id: 'round-1',
    number: 1,
    title: 'Первое ускорение',
    situation: 'Выберите один этап, с которого команда начнёт встраивать AI.',
    options: [
      option(
        'r1-a',
        'A',
        'Продуктовая проработка',
        'AI готовит черновик задачи, продукт проверяет.',
        'productDiscovery',
        { controllability: 5, deliverySpeed: 2 },
        ['currentContext'],
      ),
      option(
        'r1-b',
        'B',
        'Техническая проработка',
        'AI исследует код, инженер принимает план.',
        'technicalDiscovery',
        { quality: 3, deliverySpeed: 3 },
        ['currentContext'],
      ),
      option(
        'r1-c',
        'C',
        'Написание кода',
        'AI готовит реализацию и тесты, разработчик проверяет.',
        'coding',
        { deliverySpeed: 12, teamCapacity: 4 },
        ['humanReview'],
      ),
      option(
        'r1-d',
        'D',
        'Тестирование',
        'AI готовит проверки, QA определяет достаточность.',
        'testing',
        { quality: 8, deliverySpeed: 2 },
        ['automatedTests'],
      ),
    ],
    eventRules: [
      rule(
        event(
          'event-1-code',
          'Поток изменений вырос',
          'Код появился быстрее, а ревью и тестирование стали следующим ограничением.',
          { quality: -8, controllability: -5, teamCapacity: -6 },
          [broken('review'), broken('testing')],
        ),
        ['r1-c'],
      ),
      rule(
        event(
          'event-1-default',
          'Появился новый разрыв',
          'Ускоренный этап упёрся в соседний ручной этап.',
          { deliverySpeed: -3, controllability: -3 },
        ),
      ),
    ],
  },
  {
    id: 'round-2',
    number: 2,
    title: 'Незнакомый сервис',
    situation: 'Следующая задача пересекла границу команды. Какой участок укрепить?',
    options: [
      option(
        'r2-a',
        'A',
        'Актуальный контекст',
        'AI сверяет документацию с кодом, инженер фиксирует контракт.',
        'technicalDiscovery',
        { quality: 5, controllability: 4 },
        ['currentContext'],
      ),
      option(
        'r2-b',
        'B',
        'Ревью',
        'AI собирает контекст изменения, человек принимает риск.',
        'review',
        { quality: 6, teamCapacity: -2 },
        ['humanReview'],
      ),
      option(
        'r2-c',
        'C',
        'Автоматические тесты',
        'AI готовит проверки фактического поведения.',
        'testing',
        { quality: 7, controllability: 2 },
        ['automatedTests'],
      ),
      option(
        'r2-d',
        'D',
        'Ещё больше генерации',
        'AI сразу меняет незнакомый сервис по доступному описанию.',
        'coding',
        { deliverySpeed: 10, quality: -4 },
      ),
    ],
    eventRules: [
      conditional(
        event(
          'event-2-risk',
          'Описание устарело',
          'Решение опиралось на непроверенный контекст.',
          { quality: -11, controllability: -7, teamCapacity: -4 },
          [broken('technicalDiscovery')],
        ),
        { missingProperty: 'currentContext' },
      ),
      rule(
        event(
          'event-2-safe',
          'Контракт удалось проверить',
          'Актуальный контекст сократил область неопределённости.',
          { quality: 2, controllability: 2 },
        ),
      ),
    ],
  },
  {
    id: 'round-3',
    number: 3,
    title: 'Проверки не успевают',
    situation: 'Изменений стало больше. Куда направить следующий ход?',
    options: [
      option(
        'r3-a',
        'A',
        'Ревью по риску',
        'AI собирает доказательства, человек проверяет рискованные места.',
        'review',
        { quality: 7, controllability: 4 },
        ['humanReview'],
      ),
      option(
        'r3-b',
        'B',
        'Регрессионные тесты',
        'AI поддерживает автоматические проверки изменений.',
        'testing',
        { quality: 9, deliverySpeed: 2 },
        ['automatedTests'],
      ),
      option(
        'r3-c',
        'C',
        'Технический контекст',
        'AI обновляет карту зависимостей перед работой.',
        'technicalDiscovery',
        { controllability: 6, teamCapacity: 2 },
        ['currentContext'],
      ),
      option(
        'r3-d',
        'D',
        'Параллельные агенты',
        'Команда запускает больше изменений одновременно.',
        'coding',
        { deliverySpeed: 12, teamCapacity: -7 },
      ),
    ],
    eventRules: [
      conditional(
        event(
          'event-3-overload',
          'Очередь проверок выросла',
          'Без автоматических тестов поток снова сошёлся к людям.',
          { quality: -9, teamCapacity: -10 },
          [broken('review')],
        ),
        { missingProperty: 'automatedTests' },
      ),
      rule(
        event(
          'event-3-covered',
          'Регрессия поймана автоматически',
          'Проверка остановила ошибку до ручного разбора.',
          { quality: 3, teamCapacity: 2 },
        ),
      ),
    ],
  },
  {
    id: 'round-4',
    number: 4,
    title: 'Рискованный релиз',
    situation: 'Изменение готово к проду. Как встроить безопасность в следующий этап?',
    options: [
      option(
        'r4-a',
        'A',
        'Управляемый деплой',
        'AI готовит план выпуска, человек подтверждает шаги.',
        'deployment',
        { deliverySpeed: 4, controllability: 7 },
        ['rollback'],
      ),
      option(
        'r4-b',
        'B',
        'Наблюдаемость',
        'AI готовит сигналы и связывает их с изменением.',
        'support',
        { controllability: 8, teamCapacity: 2 },
        ['observability'],
      ),
      option(
        'r4-c',
        'C',
        'Проверка перед выпуском',
        'AI собирает набор проверок для релизного решения.',
        'testing',
        { quality: 7, deliverySpeed: -1 },
        ['automatedTests'],
      ),
      option(
        'r4-d',
        'D',
        'Автономный выпуск',
        'AI выкатывает изменение сразу после зелёных тестов.',
        'deployment',
        { deliverySpeed: 11, controllability: -5 },
      ),
    ],
    eventRules: [
      conditional(
        event(
          'event-4-no-rollback',
          'После релиза выросли ошибки',
          'Без готового отката восстановление заняло больше внимания.',
          { quality: -10, controllability: -10, teamCapacity: -7 },
          [broken('deployment')],
        ),
        { missingProperty: 'rollback' },
      ),
      rule(
        event('event-4-rollback', 'Откат сработал', 'Команда быстро вернула стабильную версию.', {
          controllability: 4,
          teamCapacity: 2,
        }),
      ),
    ],
  },
  {
    id: 'round-5',
    number: 5,
    title: 'Замыкаем цикл',
    situation: 'Последний ход должен связать разработку с обратной связью из прода.',
    options: [
      option(
        'r5-a',
        'A',
        'Диагностика поддержки',
        'AI собирает сигнал, контекст и шаги воспроизведения.',
        'support',
        { controllability: 8, teamCapacity: 4 },
        ['observability'],
      ),
      option(
        'r5-b',
        'B',
        'Безопасное восстановление',
        'AI готовит исправление и план отката, человек выпускает.',
        'deployment',
        { deliverySpeed: 4, quality: 5 },
        ['rollback'],
      ),
      option(
        'r5-c',
        'C',
        'Обратная связь в постановку',
        'AI возвращает выводы инцидента в критерии следующей задачи.',
        'businessRequest',
        { quality: 4, controllability: 6 },
        ['currentContext'],
      ),
      option(
        'r5-d',
        'D',
        'Автономный фикс',
        'AI диагностирует, исправляет и выкатывает без остановки.',
        'support',
        { deliverySpeed: 12, controllability: -8, quality: -5 },
      ),
    ],
    eventRules: [
      conditional(
        event(
          'event-5-blind',
          'Сигнала недостаточно',
          'Без наблюдаемости нельзя надёжно проверить гипотезу.',
          { quality: -8, controllability: -12, teamCapacity: -6 },
          [broken('support')],
        ),
        { missingProperty: 'observability' },
      ),
      rule(
        event(
          'event-5-loop',
          'Контекст инцидента сохранён',
          'Сигнал вернулся в проверки и следующий цикл работы.',
          { quality: 4, controllability: 5 },
        ),
      ),
    ],
  },
];

export const defaultScenario: Scenario = {
  contentStatus: 'TECHNICAL_DRAFT',
  id: 'technical-mvp',
  rounds,
  rules: defaultRules,
  version: 1,
};

function option(
  id: string,
  key: string,
  title: string,
  description: string,
  stage: StageKey,
  effect: MetricDelta,
  addProperties: ProcessProperty[] = [],
): EngineOption {
  return {
    addProperties,
    description,
    effect,
    evidence: 'SCENARIO',
    id,
    key,
    shortFeedback: 'Технический черновик: условия и риски уточним после прогона.',
    stage,
    stageChanges: [{ stage, state: 'AI_ENABLED' }],
    title,
  };
}

function event(
  id: string,
  title: string,
  description: string,
  effect: MetricDelta,
  stageChanges: StageMutation[] = [],
  evidence: EvidenceKind = 'SCENARIO',
): EngineEvent {
  return { description, effect, evidence, id, stageChanges, title };
}

function broken(stage: StageKey): StageMutation {
  return { stage, state: 'BROKEN' };
}

function rule(eventValue: EngineEvent, optionIds?: string[]): EventRule {
  return { event: eventValue, optionIds };
}

function conditional(eventValue: EngineEvent, condition: Omit<EventRule, 'event'>): EventRule {
  return { event: eventValue, ...condition };
}
