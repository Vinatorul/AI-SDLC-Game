import type { AdminCommand, GameState } from './domain';

export type CreateGameResponse = {
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

export type VoteRequest = {
  optionId: string;
};

export type VoteResponse = {
  state: GameState;
};

export type AdminCommandRequest = AdminCommand;

export type AdminCommandResponse = {
  state: GameState;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  state?: GameState;
};

export type RevisionMessage = {
  revision: number;
  type: 'revision';
};
