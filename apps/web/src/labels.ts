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
  BROKEN: 'Игра завершена',
  EVENT: 'Событие',
  FEEDBACK: 'Разбор последствий',
  LOBBY: 'Лобби',
  RESULT: 'Результат голосования',
  VOTING: 'Голосование',
  WON: 'Победа',
};

export const propertyLabels: Record<ProcessProperty, string> = {
  automatedTests: 'Автоматические тесты',
  currentContext: 'Актуальный контекст',
  humanReview: 'Проверка человеком',
  observability: 'Наблюдаемость',
  rollback: 'Откат',
};

export const outcomeLabels: Record<OutcomeReason, string> = {
  AI_NOT_EMBEDDED: 'AI не успели встроить в нужное число этапов.',
  BROKEN_STAGES_REMAIN: 'На карте остались сломанные этапы.',
  CRITICAL_METRIC: 'Один из показателей пересёк критический порог.',
};
