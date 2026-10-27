import { USABLE_LEVEL } from '../engine/core/backend';
import type { LayoutOptions } from '../workers/protocol/layout';
import type { Context } from './store';
import { exposeSettledLayout } from './testHooks';

const DEFAULT_OPTIONS: LayoutOptions = { seed: 1, quality: 'balanced' };

export type LayoutStatus =
  | { state: 'idle' }
  | {
      state: 'running';
      iteration: number;
      total: number;
      /** Only the GPU layout reports these. */
      level?: number;
      levels?: number;
      energy?: number;
    }
  | { state: 'done'; total: number; ms: number; usableMs?: number | undefined }
  | { state: 'failed'; message: string };

export interface LayoutSlice {
  layoutOptions: LayoutOptions;
  layoutStatus: LayoutStatus;
  layoutPaused: boolean;
  /** Segments pinned by dragging. */
  pinned: number;
  /** A refinement after a drag or of the selection is running. */
  refining: boolean;
  unpinAll: () => void;
  /** Lays out the selection again on the finest level, holding everything else. */
  relayoutSelection: () => void;
  setLayoutOptions: (options: LayoutOptions) => void;
  /** Pauses or resumes the GPU layout; the CPU layout cannot pause. */
  setLayoutPaused: (paused: boolean) => void;
  /** Lays out the loaded graph from the start, when it and its renderer are ready. */
  restartLayout: () => void;
  stopLayout: () => void;
}

const ignore = () => undefined;

/**
 * On the GPU through the engine, or in the layout worker with `?layout=cpu`.
 * The worker always builds the geometry and, for the GPU, the coarsened
 * levels and the component packing.
 */
export function createLayoutSlice(ctx: Context): LayoutSlice {
  const { set, get, services } = ctx;
  let stopRun: (() => void) | undefined;

  function run(): () => void {
    const { load, gpuLayout: gpu, layoutOptions: options } = get();
    if (load.state !== 'loaded') return ignore;
    const bridge = ctx.bridge;
    const { seed, quality } = options;
    const client = services.layoutClient();
    ctx.layout = client;
    const start = performance.now();
    let live = true;
    let total = 0;
    let usableMs: number | undefined;
    let measuredLevel = Infinity;
    let finished = false;
    const status = (layoutStatus: LayoutStatus) => {
      if (live) set({ layoutStatus });
    };

    const unsubscribe = bridge.on((event) => {
      if (event.type === 'positions' && finished) exposeSettledLayout({ seed, quality, positions: event.positions });
      if (event.type !== 'layout-measured') return;
      const p = event.progress;
      measuredLevel = p.level;
      finished = p.done;
      client.pack(event.boxes).then((offsets) => {
        if (!live) return;
        bridge.send({ type: 'set-offsets', offsets });
        if (usableMs === undefined && measuredLevel <= USABLE_LEVEL) usableMs = performance.now() - start;
        if (finished) {
          status({ state: 'done', total, ms: performance.now() - start, usableMs });
          if (import.meta.env.DEV) bridge.send({ type: 'read-positions' });
        }
      }, ignore);
      if (!p.done) {
        status({ state: 'running', iteration: p.iteration, total, level: p.level, levels: p.levels, energy: p.energy });
      }
    });

    client.start(gpu ? 'gpu' : 'cpu', load.result.topology, options, (response) => {
      if (!live) return;
      switch (response.type) {
        case 'geometry':
          total = response.totalIterations;
          set({ fps: undefined });
          bridge.send({
            type: 'set-graph',
            geometry: response.geometry,
            seed,
            segments: { ...load.result.attributes, ...load.result.topology, meanDepth: load.result.stats.meanDepth },
          });
          get().refreshLabels();
          status({ state: 'running', iteration: 0, total });
          break;
        case 'hierarchy':
          bridge.send({ type: 'start-layout', hierarchy: response.hierarchy, seed });
          break;
        case 'positions':
          bridge.send({ type: 'set-positions', positions: response.positions });
          if (response.done) exposeSettledLayout({ seed, quality, positions: response.positions });
          status(
            response.done
              ? { state: 'done', total, ms: performance.now() - start }
              : { state: 'running', iteration: response.iteration, total },
          );
          break;
        case 'error':
          status({ state: 'failed', message: response.message });
          break;
        default:
          break;
      }
    });

    return () => {
      live = false;
      if (ctx.layout === client) ctx.layout = undefined;
      unsubscribe();
      client.cancel();
    };
  }

  return {
    layoutOptions: DEFAULT_OPTIONS,
    layoutStatus: { state: 'idle' },
    layoutPaused: false,
    pinned: 0,
    refining: false,

    unpinAll() {
      ctx.bridge.send({ type: 'unpin-all' });
    },

    relayoutSelection() {
      ctx.bridge.send({ type: 'relayout-selection' });
    },

    setLayoutOptions(layoutOptions) {
      set({ layoutOptions });
      get().restartLayout();
    },

    setLayoutPaused(paused) {
      if (get().layoutStatus.state !== 'running' || !get().gpuLayout) return;
      ctx.bridge.send({ type: 'pause-layout', paused });
      set({ layoutPaused: paused });
    },

    restartLayout() {
      get().stopLayout();
      if (get().gpuLayout && !ctx.bridge.attached) return;
      stopRun = run();
    },

    stopLayout() {
      stopRun?.();
      stopRun = undefined;
      set({ layoutStatus: { state: 'idle' }, layoutPaused: false, pinned: 0, refining: false });
    },
  };
}
