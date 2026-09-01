import type {
  GamePhase,
  OutcomeReason,
  ProcessProperty,
  StageKey,
  StageState,
} from '@ai-sdlc/contracts';

export const stageLabels: Record<StageKey, string> = {
  businessRequest: 'Бизнес-заказ',
  coding: 'Написание кода',
  deployment: 'Деплой',
  productDiscovery: 'Продуктовая проработка',
  review: 'Ревью',
  support: 'Поддержка',
  technicalDiscovery: 'Техническая проработка',
  testing: 'Тестирование',
};

export const stageStateLabels: Record<StageState, string> = {
  AI_ENABLED: 'AI встроен',
  AS_IS: 'Работает как раньше',
  BROKEN: 'Сломано',
};

export const phaseLabels: Record<GamePhase, string> = {
  BROKEN: 'Поражение',
  EVENT: 'Событие хода',
  FEEDBACK: 'Что изменилось',
  LOBBY: 'Ждём игроков',
  RESULT: 'Голосование завершено',
  VOTING: 'Идёт голосование',
  WON: 'Победа',
};

export const propertyLabels: Record<ProcessProperty, string> = {
  automatedTests: 'Автоматические тесты',
  currentContext: 'Актуальные данные и документация',
  humanReview: 'Проверка человеком',
  observability: 'Мониторинг и логи',
  rollback: 'Быстрый откат',
};

export const outcomeLabels: Record<OutcomeReason, string> = {
  AI_NOT_EMBEDDED: 'Игра закончилась раньше, чем AI заработал на нужном числе этапов.',
  BROKEN_STAGES_REMAIN: 'Не все сломанные этапы удалось починить.',
  CRITICAL_METRIC: 'Одна из метрик упала до критического уровня.',
};
