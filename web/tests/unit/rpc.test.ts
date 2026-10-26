import { describe, expect, it } from 'vitest';
import { expect as expectType, RpcClient, WorkerTerminatedError } from '../../src/workers/rpc';

type Req = { type: 'echo'; id: number; value: number } | { type: 'count'; id: number; to: number };
type Res =
  | { type: 'echoed'; id: number; value: number }
  | { type: 'tick'; id: number; n: number }
  | { type: 'counted'; id: number }
  | { type: 'error'; id: number; message: string };

class FakeWorker {
  readonly sent: unknown[] = [];
  terminated = false;
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  postMessage(message: Req): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(data: Res): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data });
  }
}

function client() {
  const workers: FakeWorker[] = [];
  const rpc = new RpcClient<Req, Res>({
    name: 'test',
    spawn: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    },
    isUpdate: (response) => response.type === 'tick',
  });
  const current = () => {
    const worker = workers.at(-1);
    if (!worker) throw new Error('no worker');
    return worker;
  };
  return { rpc, workers, current };
}

describe('RpcClient', () => {
  it('matches responses to requests by id', async () => {
    const { rpc, current } = client();
    const a = rpc.request({ type: 'echo', value: 1 });
    const b = rpc.request({ type: 'echo', value: 2 });
    current().reply({ type: 'echoed', id: 2, value: 20 });
    current().reply({ type: 'echoed', id: 1, value: 10 });
    expect(expectType(await a, 'echoed').value).toBe(10);
    expect(expectType(await b, 'echoed').value).toBe(20);
  });

  it('passes updates on until the final response', async () => {
    const { rpc, current } = client();
    const ticks: number[] = [];
    const done = rpc.request(
      { type: 'count', to: 2 },
      {
        onUpdate: (update) => {
          if (update.type === 'tick') ticks.push(update.n);
        },
      },
    );
    current().reply({ type: 'tick', id: 1, n: 1 });
    current().reply({ type: 'tick', id: 1, n: 2 });
    current().reply({ type: 'counted', id: 1 });
    current().reply({ type: 'tick', id: 1, n: 3 });
    expect((await done).type).toBe('counted');
    expect(ticks).toEqual([1, 2]);
  });

  it('rejects on an error response', async () => {
    const { rpc, current } = client();
    const failed = rpc.request({ type: 'echo', value: 1 });
    current().reply({ type: 'error', id: 1, message: 'bad input' });
    await expect(failed).rejects.toThrow('bad input');
  });

  it('cancelling rejects what is pending and starts a fresh worker', async () => {
    const { rpc, workers, current } = client();
    const pending = rpc.request({ type: 'echo', value: 1 });
    rpc.cancel();
    await expect(pending).rejects.toBeInstanceOf(WorkerTerminatedError);
    expect(workers).toHaveLength(2);
    expect(workers[0]?.terminated).toBe(true);
    const next = rpc.request({ type: 'echo', value: 5 });
    current().reply({ type: 'echoed', id: 2, value: 5 });
    expect((await next).type).toBe('echoed');
  });

  it('narrows a response or throws on the wrong type', () => {
    expect(() => expectType<Res, 'echoed'>({ type: 'counted', id: 1 }, 'echoed')).toThrow(
      'expected echoed, got counted',
    );
  });
});
