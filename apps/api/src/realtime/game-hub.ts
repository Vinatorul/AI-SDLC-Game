import type { RevisionMessage } from '@ai-sdlc/contracts';
import type { WebSocket } from 'ws';

export class GameHub {
  private readonly sockets = new Map<string, Set<WebSocket>>();

  add(code: string, socket: WebSocket) {
    const group = this.sockets.get(code) ?? new Set<WebSocket>();
    group.add(socket);
    this.sockets.set(code, group);
    return () => this.remove(code, socket);
  }

  publish(code: string, revision: number) {
    const payload: RevisionMessage = { revision, type: 'revision' };
    for (const socket of this.sockets.get(code) ?? []) {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
    }
  }

  private remove(code: string, socket: WebSocket) {
    const group = this.sockets.get(code);
    if (!group) return;
    group.delete(socket);
    if (group.size === 0) this.sockets.delete(code);
  }
}
