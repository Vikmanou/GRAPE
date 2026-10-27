import type { LevelRecord } from '../engine/core/backend';
import type { EngineCommand, EngineEvent } from '../engine/commands';
import type { WorkerMemory } from '../workers/rpc';
import type { Bridge } from './bridge';
import type { AppStore, Context } from './store';

export interface SettledLayout {
  /** Counts settled layouts, so a test can tell a new one from the last. */
  run: number;
  seed: number;
  quality: string;
  /** `x, y` per point as drawn. */
  positions: Float32Array;
}

/** Bytes held by each part of the page, for the benchmarks' memory budgets. */
export interface MemoryReport {
  /** The main thread's JS heap, without array buffers. */
  mainHeap: number;
  /** Typed arrays the store and the engine keep on the main thread. */
  mainArrays: number;
  gpu: number;
  graph: WorkerMemory;
  sequence: WorkerMemory;
  layout: WorkerMemory;
}

let runs = 0;

export interface TestHooks {
  store: AppStore;
  send: Bridge['send'];
  on: Bridge['on'];
  memory: () => Promise<MemoryReport>;
  layoutProfile: () => Promise<LevelRecord[]>;
}

/** Sends a command and waits for the event that answers it. */
function ask<T extends EngineEvent['type']>(
  bridge: Bridge,
  command: EngineCommand,
  answer: T,
): Promise<Extract<EngineEvent, { type: T }>> {
  return new Promise((resolve) => {
    const off = bridge.on((event) => {
      if (event.type !== answer) return;
      off();
      resolve(event as Extract<EngineEvent, { type: T }>);
    });
    bridge.send(command);
  });
}

async function memory(ctx: Context): Promise<MemoryReport> {
  const { load } = ctx.get();
  const r = load.state === 'loaded' ? load.result : undefined;
  const t = r?.topology;
  const held: ArrayBufferView[] =
    r && t ? [t.lengths, t.components, t.linkFrom, t.linkTo, t.linkBits, r.attributes.depth, r.attributes.gc] : [];
  const arrays = held.reduce((sum, a) => sum + a.byteLength, 0);
  const [engine, graph, sequence, layout] = await Promise.all([
    ask(ctx.bridge, { type: 'report-memory' }, 'memory'),
    ctx.services.graph.memory(),
    ctx.services.sequence.memory(),
    ctx.layout?.memory() ?? { wasm: 0, held: 0 },
  ]);
  // Chrome only, and not in the standard.
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return {
    mainHeap: heap?.usedJSHeapSize ?? 0,
    mainArrays: arrays + engine.cpu,
    gpu: engine.gpu,
    graph,
    sequence,
    layout,
  };
}

/** Development builds put the store and the engine bridge on `window.grapeTest` for browser tests. */
export function exposeForTests(store: AppStore, ctx: Context): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  const bridge = ctx.bridge;
  const hooks: TestHooks = {
    store,
    send: (command) => {
      bridge.send(command);
    },
    on: (listener) => bridge.on(listener),
    memory: () => memory(ctx),
    layoutProfile: async () => (await ask(bridge, { type: 'report-layout-profile' }, 'layout-profile')).levels,
  };
  (window as Window & { grapeTest?: TestHooks }).grapeTest = hooks;
}

/**
 * Development builds put the last settled layout on `window.grapeLayout`
 * for the browser tests and the layout benchmark; production builds leave
 * it out.
 */
export function exposeSettledLayout(layout: Omit<SettledLayout, 'run'>): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  runs += 1;
  (window as Window & { grapeLayout?: SettledLayout }).grapeLayout = { run: runs, ...layout };
}
