import { describe, expect, it } from 'vitest';
import type { EngineCommand, EngineEvent } from '../../src/engine/commands';
import type { EngineLike } from '../../src/state/bridge';
import { createAppStore, type LayoutService, type Services } from '../../src/state/store';
import type { ParseResult } from '../../src/workers/protocol/graph';
import type { LayoutResponse } from '../../src/workers/protocol/layout';
import { WorkerTerminatedError } from '../../src/workers/rpc';

class FakeEngine implements EngineLike {
  readonly sent: EngineCommand[] = [];
  destroyed = false;
  private listener: ((event: EngineEvent) => void) | undefined;

  send(command: EngineCommand): void {
    this.sent.push(command);
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.listener = listener;
    return () => undefined;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(event: EngineEvent): void {
    this.listener?.(event);
  }

  types(): string[] {
    return this.sent.map((c) => c.type);
  }
}

class FakeLayout implements LayoutService {
  listener: ((response: LayoutResponse) => void) | undefined;
  cancelled = false;
  packs: Float32Array[] = [];

  start(_mode: 'cpu' | 'gpu', _t: unknown, _o: unknown, listener: (response: LayoutResponse) => void): void {
    this.listener = listener;
  }

  pack(boxes: Float32Array<ArrayBuffer>): Promise<Float32Array> {
    this.packs.push(boxes);
    return Promise.resolve(new Float32Array(boxes.length / 2));
  }

  memory() {
    return Promise.resolve({ wasm: 0, held: 0 });
  }

  cancel(): void {
    this.cancelled = true;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const result = { topology: {} } as unknown as ParseResult;
const parsed = { result, sequences: { kind: 'dropped' } as const };
type Parsed = typeof parsed;
const geometry = {
  segments: 1,
  points: 2,
  pieces: new Uint32Array(2),
  links: new Uint32Array(0),
  segmentStarts: new Uint32Array(1),
  segmentPieces: Uint8Array.of(1),
};
const progress = { iteration: 10, total: 10, level: 0, levels: 1, energy: 0, done: true };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const parses: ReturnType<typeof deferred<Parsed>>[] = [];
  const layouts: FakeLayout[] = [];
  const engines: FakeEngine[] = [];
  let cancels = 0;
  const loadedSources: unknown[] = [];
  const services: Services = {
    sequence: {
      load: (source) => {
        loadedSources.push(source);
        return Promise.resolve();
      },
      preview: () => Promise.reject(new Error('unused')),
      sequence: () => Promise.reject(new Error('unused')),
      rawLine: () => Promise.reject(new Error('unused')),
      fasta: () => Promise.reject(new Error('unused')),
      memory: () => Promise.reject(new Error('unused')),
    },
    graph: {
      ping: () => Promise.resolve({ coreVersion: 'test', roundTripMs: 1 }),
      parse: () => {
        const parse = deferred<Parsed>();
        parses.push(parse);
        return parse.promise;
      },
      info: () => Promise.reject(new Error('unused')),
      summary: () => Promise.reject(new Error('unused')),
      find: () => Promise.reject(new Error('unused')),
      exportRecords: () => Promise.reject(new Error('unused')),
      memory: () => Promise.reject(new Error('unused')),
      cancel: () => {
        cancels++;
        for (const p of parses) p.reject(new WorkerTerminatedError('graph'));
      },
    },
    layoutClient: () => {
      const layout = new FakeLayout();
      layouts.push(layout);
      return layout;
    },
    createEngine: () => {
      const engine = new FakeEngine();
      engines.push(engine);
      return Promise.resolve(engine);
    },
    detectBackend: () => Promise.resolve('webgpu'),
    search: '',
  };
  const store = createAppStore(services);
  return { store, parses, layouts, engines, loadedSources, cancels: () => cancels };
}

async function loadedWithEngine() {
  const s = setup();
  const app = s.store.getState();
  await app.detectRenderer();
  await app.attachEngine({} as HTMLElement);
  app.open(new File(['S\ta\t*'], 'a.gfa'));
  s.parses[0]?.resolve(parsed);
  await flush();
  return s;
}

describe('store', () => {
  it('starts a GPU layout once the file is loaded and the engine attached', async () => {
    const { store, layouts, engines, loadedSources } = await loadedWithEngine();
    expect(store.getState().load.state).toBe('loaded');
    expect(loadedSources).toEqual([parsed.sequences]);
    const layout = layouts.at(-1);
    const engine = engines[0];
    if (!layout || !engine) throw new Error('no layout or engine');
    layout.listener?.({ type: 'geometry', id: 1, geometry, totalIterations: 10 });
    layout.listener?.({
      type: 'hierarchy',
      id: 1,
      hierarchy: { levels: [], start: new Float32Array(), frozen: new Uint8Array() },
    });
    expect(engine.types()).toEqual(['set-theme', 'set-insets', 'set-graph', 'start-layout']);
    expect(store.getState().layoutStatus).toEqual({ state: 'running', iteration: 0, total: 10 });

    engine.emit({ type: 'layout-measured', boxes: new Float32Array(4), progress });
    await flush();
    expect(layout.packs).toHaveLength(1);
    expect(engine.types()).toContain('set-offsets');
    expect(store.getState().layoutStatus.state).toBe('done');
  });

  it('restarts the layout when the options change', async () => {
    const { store, layouts } = await loadedWithEngine();
    const first = layouts.at(-1);
    store.getState().setLayoutOptions({ seed: 7, quality: 'fast' });
    expect(first?.cancelled).toBe(true);
    expect(layouts.at(-1)).not.toBe(first);
    expect(store.getState().layoutOptions.seed).toBe(7);
  });

  it('a newer file replaces one still parsing', async () => {
    const { store, parses, cancels } = setup();
    store.getState().open(new File(['a'], 'first.gfa'));
    store.getState().open(new File(['b'], 'second.gfa'));
    expect(cancels()).toBe(1);
    parses[1]?.resolve(parsed);
    await flush();
    const load = store.getState().load;
    expect(load.state === 'loaded' && load.file.name).toBe('second.gfa');
  });

  it('cancelling a parse returns to idle and ignores its result', async () => {
    const { store } = setup();
    store.getState().open(new File(['a'], 'a.gfa'));
    store.getState().cancelLoad();
    await flush();
    expect(store.getState().load.state).toBe('idle');
  });

  it('a lost device reports an error and drops the engine and its layout', async () => {
    const { store, engines, layouts } = await loadedWithEngine();
    engines[0]?.emit({ type: 'device-lost', message: 'gone' });
    expect(store.getState().engineError).toBe('GPU device lost: gone');
    expect(engines[0]?.destroyed).toBe(true);
    expect(layouts.at(-1)?.cancelled).toBe(true);
    expect(store.getState().layoutStatus.state).toBe('idle');
  });

  it('panel insets measured before the engine exists reach it when it attaches', async () => {
    const { store, engines } = setup();
    const insets = { top: 40, right: 0, bottom: 28, left: 330 };
    store.getState().setInsets(insets);
    await store.getState().attachEngine({} as HTMLElement);
    expect(engines[0]?.sent).toContainEqual({ type: 'set-insets', insets });
  });

  it('an engine that arrives after detaching is destroyed', async () => {
    const { store, engines } = setup();
    const attaching = store.getState().attachEngine({} as HTMLElement);
    store.getState().detachEngine();
    await attaching;
    expect(engines[0]?.destroyed).toBe(true);
  });
});
