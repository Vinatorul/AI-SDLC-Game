import type { GamePhase } from '@ai-sdlc/contracts';

export const phaseLabels: Record<GamePhase, string> = {
  BROKEN: 'Поражение',
  EVENT: 'Событие хода',
  FEEDBACK: 'Что изменилось',
  LOBBY: 'Ждём игроков',
  RESULT: 'Голосование завершено',
  VOTING: 'Идёт голосование',
  WON: 'Победа',
};
