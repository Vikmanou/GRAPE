import type { ParseRequest, ParseResponse, ParseResult } from './protocol';

/** Rejection for requests still pending when the worker is stopped. */
export class WorkerTerminatedError extends Error {
  constructor() {
    super('parse worker terminated');
    this.name = 'WorkerTerminatedError';
  }
}

export interface PingResult {
  coreVersion: string;
  roundTripMs: number;
}

export type ProgressListener = (bytesRead: number, totalBytes: number) => void;

type Settled = Extract<ParseResponse, { type: 'pong' | 'parsed' }>;

interface Pending {
  resolve: (response: Settled) => void;
  reject: (error: Error) => void;
  onProgress?: ProgressListener;
}

export class ParseClient {
  private worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  constructor() {
    this.worker = this.spawn();
  }

  async ping(): Promise<PingResult> {
    const start = performance.now();
    const response = await this.request({ type: 'ping', id: this.nextId++ });
    if (response.type !== 'pong') throw new Error(`unexpected ${response.type} response`);
    return { coreVersion: response.coreVersion, roundTripMs: performance.now() - start };
  }

  async parse(file: File, onProgress?: ProgressListener): Promise<ParseResult> {
    const response = await this.request({ type: 'parse', id: this.nextId++, file }, onProgress);
    if (response.type !== 'parsed') throw new Error(`unexpected ${response.type} response`);
    return response.result;
  }

  /** WASM cannot be interrupted mid-call, so cancelling replaces the worker. */
  cancel(): void {
    this.worker.terminate();
    this.failAll(new WorkerTerminatedError());
    this.worker = this.spawn();
  }

  terminate(): void {
    this.worker.terminate();
    this.failAll(new WorkerTerminatedError());
  }

  private spawn(): Worker {
    const worker = new Worker(new URL('./parse.worker.ts', import.meta.url), { type: 'module', name: 'parse' });
    worker.addEventListener('message', (event: MessageEvent<ParseResponse>) => {
      this.settle(event.data);
    });
    worker.addEventListener('error', (event) => {
      this.failAll(new Error(`parse worker failed: ${event.message || 'unknown error'}`));
    });
    return worker;
  }

  private request(request: ParseRequest, onProgress?: ProgressListener): Promise<Settled> {
    return new Promise((resolve, reject) => {
      this.pending.set(request.id, { resolve, reject, ...(onProgress ? { onProgress } : {}) });
      this.worker.postMessage(request);
    });
  }

  private settle(response: ParseResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (response.type === 'progress') {
      pending.onProgress?.(response.bytesRead, response.totalBytes);
      return;
    }
    this.pending.delete(response.id);
    if (response.type === 'error') pending.reject(new Error(response.message));
    else pending.resolve(response);
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
