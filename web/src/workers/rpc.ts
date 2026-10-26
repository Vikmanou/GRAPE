// Every request carries an id that its responses echo. A request gets any
// number of updates (progress, partial results) and then one final response;
// an `error` response rejects it.

export interface Message {
  type: string;
  id: number;
}

export interface ErrorResponse {
  type: 'error';
  id: number;
  message: string;
}

/** Rejection for requests still pending when the worker is stopped. */
export class WorkerTerminatedError extends Error {
  constructor(name: string) {
    super(`${name} worker terminated`);
    this.name = 'WorkerTerminatedError';
  }
}

type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never;

export interface RequestOptions<Res> {
  transfer?: Transferable[];
  onUpdate?: (update: Res) => void;
}

interface Pending<Res> {
  resolve: (response: Res) => void;
  reject: (error: Error) => void;
  onUpdate: ((update: Res) => void) | undefined;
}

export interface WorkerSpec<Res> {
  name: string;
  spawn: () => Worker;
  /** Whether a response is an update rather than the request's answer. */
  isUpdate: (response: Res) => boolean;
}

export class RpcClient<Req extends Message, Res extends Message> {
  private worker: Worker;
  private readonly pending = new Map<number, Pending<Res>>();
  private nextId = 1;

  constructor(private readonly spec: WorkerSpec<Res>) {
    this.worker = this.start();
  }

  request(request: WithoutId<Req>, options: RequestOptions<Res> = {}): Promise<Res> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onUpdate: options.onUpdate });
      this.worker.postMessage({ ...request, id }, { transfer: options.transfer ?? [] });
    });
  }

  /** WASM cannot be interrupted mid-call, so cancelling replaces the worker. */
  cancel(): void {
    this.worker.terminate();
    this.failAll(new WorkerTerminatedError(this.spec.name));
    this.worker = this.start();
  }

  terminate(): void {
    this.worker.terminate();
    this.failAll(new WorkerTerminatedError(this.spec.name));
  }

  private start(): Worker {
    const worker = this.spec.spawn();
    worker.addEventListener('message', (event: MessageEvent<Res | ErrorResponse>) => {
      this.settle(event.data);
    });
    worker.addEventListener('error', (event) => {
      this.failAll(new Error(`${this.spec.name} worker failed: ${event.message || 'unknown error'}`));
    });
    return worker;
  }

  private settle(response: Res | ErrorResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    if (isError(response)) {
      this.pending.delete(response.id);
      pending.reject(new Error(response.message));
    } else if (this.spec.isUpdate(response)) {
      pending.onUpdate?.(response);
    } else {
      this.pending.delete(response.id);
      pending.resolve(response);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function isError(response: Message): response is ErrorResponse {
  return response.type === 'error';
}

/** Narrows a final response to the type the request expects. */
export function expect<Res extends Message, T extends Res['type']>(response: Res, type: T): Extract<Res, { type: T }> {
  if (response.type !== type) throw new Error(`expected ${type}, got ${response.type}`);
  return response as Extract<Res, { type: T }>;
}
