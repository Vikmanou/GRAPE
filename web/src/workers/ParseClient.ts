import type { ParseRequest, ParseResponse } from './protocol';

/** Rejection for requests still pending when the client is terminated. */
export class WorkerTerminatedError extends Error {
  constructor() {
    super('parse worker terminated');
    this.name = 'WorkerTerminatedError';
  }
}

export interface PingResult {
  coreVersion: string;
  lines: number;
  roundTripMs: number;
}

type Pending = {
  resolve: (response: Extract<ParseResponse, { type: 'pong' }>) => void;
  reject: (error: Error) => void;
};

/** Main-thread handle to the parse worker, with promise-based requests. */
export class ParseClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = new Worker(new URL('./parse.worker.ts', import.meta.url), {
      type: 'module',
      name: 'parse',
    });
    this.worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
      this.settle(event.data);
    });
    this.worker.addEventListener('error', (event) => {
      this.failAll(new Error(`parse worker failed: ${event.message || 'unknown error'}`));
    });
  }

  /** Round trip through the worker and WASM, used as a health check. */
  async ping(sample: Uint8Array): Promise<PingResult> {
    const start = performance.now();
    const id = this.nextId++;
    const response = await new Promise<Extract<ParseResponse, { type: 'pong' }>>(
      (resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        const request: ParseRequest = { type: 'ping', id, sample };
        this.worker.postMessage(request);
      },
    );
    return {
      coreVersion: response.coreVersion,
      lines: response.lines,
      roundTripMs: performance.now() - start,
    };
  }

  terminate(): void {
    this.worker.terminate();
    this.failAll(new WorkerTerminatedError());
  }

  private settle(response: ParseResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.type === 'pong') pending.resolve(response);
    else pending.reject(new Error(response.message));
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
