import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { LayoutClient } from '../workers/LayoutClient';
import type { LayoutOptions, Topology } from '../workers/protocol';
import { exposeSettledLayout } from './testHooks';

export const DEFAULT_OPTIONS: LayoutOptions = { seed: 1, quality: 'balanced' };

/** The spec's "first usable layout": refined this far and packed. */
const USABLE_LEVEL = 3;

const IDLE = { state: 'idle' } as const;

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

export interface LayoutRun {
  status: LayoutStatus;
  paused: boolean;
  /** Pauses or resumes the GPU layout; the CPU layout cannot pause. */
  setPaused: (paused: boolean) => void;
}

/**
 * Lays out `topology`: on the GPU through `engine` when `gpu` is set,
 * otherwise in the layout worker. The worker always builds the geometry and,
 * for the GPU, the coarsened levels and the component packing.
 */
export function useLayout(
  topology: Topology | undefined,
  engine: Engine | undefined,
  gpu: boolean,
  options: LayoutOptions,
  onGeometry: () => void,
): LayoutRun {
  // Tagged with its run, so a stale run reads as idle without an effect resetting it.
  const [run, setRun] = useState<{ topology?: Topology; key?: string; status: LayoutStatus }>({ status: IDLE });
  const [pausedRun, setPausedRun] = useState<{ topology: Topology; key: string }>();
  const onGeometryRef = useRef(onGeometry);
  useEffect(() => {
    onGeometryRef.current = onGeometry;
  }, [onGeometry]);
  const { seed, quality } = options;
  const key = `${gpu ? 'gpu' : 'cpu'}:${seed}:${quality}`;

  useEffect(() => {
    if (!topology || (gpu && !engine)) return;
    const setStatus = (status: LayoutStatus) => {
      setRun({ topology, key, status });
    };
    const client = new LayoutClient();
    const start = performance.now();
    let total = 0;
    let usableMs: number | undefined;
    let measuredLevel = Infinity;
    let finished = false;
    const unsubscribe = engine?.on((event) => {
      if (event.type === 'positions' && finished) exposeSettledLayout({ seed, quality, positions: event.positions });
      if (event.type !== 'layout-measured') return;
      const p = event.progress;
      measuredLevel = p.level;
      finished = p.done;
      client.pack(event.boxes);
      if (!p.done) {
        setStatus({
          state: 'running',
          iteration: p.iteration,
          total,
          level: p.level,
          levels: p.levels,
          energy: p.energy,
        });
      }
    });
    client.start(gpu ? 'gpu' : 'cpu', topology, { seed, quality }, (response) => {
      switch (response.type) {
        case 'geometry':
          total = response.totalIterations;
          onGeometryRef.current();
          engine?.send({ type: 'set-graph', geometry: response.geometry, seed });
          setStatus({ state: 'running', iteration: 0, total });
          break;
        case 'hierarchy':
          engine?.send({ type: 'start-layout', hierarchy: response.hierarchy, seed });
          break;
        case 'packed':
          engine?.send({ type: 'set-offsets', offsets: response.offsets });
          if (usableMs === undefined && measuredLevel <= USABLE_LEVEL) usableMs = performance.now() - start;
          if (finished) {
            setStatus({ state: 'done', total, ms: performance.now() - start, usableMs });
            if (import.meta.env.DEV) engine?.send({ type: 'read-positions' });
          }
          break;
        case 'positions':
          engine?.send({ type: 'set-positions', positions: response.positions });
          if (response.done) exposeSettledLayout({ seed, quality, positions: response.positions });
          setStatus(
            response.done
              ? { state: 'done', total, ms: performance.now() - start }
              : { state: 'running', iteration: response.iteration, total },
          );
          break;
        case 'error':
          setStatus({ state: 'failed', message: response.message });
          break;
      }
    });
    return () => {
      unsubscribe?.();
      client.cancel();
    };
  }, [topology, engine, gpu, seed, quality, key]);

  // A GPU layout whose engine went away, such as after losing the device, is over.
  const current = run.topology === topology && run.key === key && (!gpu || engine !== undefined);
  const paused = pausedRun !== undefined && pausedRun.topology === topology && pausedRun.key === key;
  const setPaused = useCallback(
    (pause: boolean) => {
      if (!engine || !topology) return;
      engine.send({ type: 'pause-layout', paused: pause });
      setPausedRun(pause ? { topology, key } : undefined);
    },
    [engine, topology, key],
  );
  return { status: current ? run.status : IDLE, paused, setPaused };
}
