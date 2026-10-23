// Message types between the main thread and the parse worker. Every request
// carries an id that its response echoes.

export type ParseRequest = { type: 'ping'; id: number; sample: Uint8Array };

export type ParseResponse =
  | { type: 'pong'; id: number; coreVersion: string; lines: number }
  | { type: 'error'; id: number; message: string };
