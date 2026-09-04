import type { AdminCommand, AdminForecast, GameState } from './domain';

export type CreateGameRequest = {
  code?: string;
};

export type CreateGameResponse = {
  adminToken: string;
  state: GameState;
};

export type AdminLoginRequest = {
  password: string;
};

export type AdminLoginResponse = {
  adminToken: string;
  state: GameState;
};

export type JoinGameRequest = {
  name: string;
};

export type JoinGameResponse = {
  playerId: string;
  playerToken: string;
  state: GameState;
};

export type VoteRequest =
  | { ballotId: string; choiceId: string; optionId?: never }
  | { ballotId?: never; choiceId?: never; optionId: string };

export type VoteResponse = {
  state: GameState;
};

export type AdminCommandRequest = AdminCommand;

export type AdminCommandResponse = {
  state: GameState;
};

export type AdminForecastResponse = AdminForecast;

export type ApiErrorBody = {
  code: string;
  message: string;
  state?: GameState;
};

export type RevisionMessage = {
  revision: number;
  type: 'revision';
};
