import type { GameState } from '@ai-sdlc/contracts';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly state?: GameState,
  ) {
    super(message);
  }
}

export function assertFound<T>(
  value: T | undefined | null,
  message = 'Комната с таким кодом не найдена',
): T {
  if (value === undefined || value === null) throw new AppError(404, 'NOT_FOUND', message);
  return value;
}

export function assertCondition(
  condition: unknown,
  statusCode: number,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new AppError(statusCode, code, message);
}
