import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { LayoutClient } from '../workers/LayoutClient';
import type { LayoutOptions, Topology } from '../workers/protocol';

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
): LayoutStatus {
  // Tagged with its run, so a stale run reads as idle without an effect resetting it.
  const [run, setRun] = useState<{ topology?: Topology; key?: string; status: LayoutStatus }>({ status: IDLE });
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
          if (finished) setStatus({ state: 'done', total, ms: performance.now() - start, usableMs });
          break;
        case 'positions':
          engine?.send({ type: 'set-positions', positions: response.positions });
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

  return run.topology === topology && run.key === key ? run.status : IDLE;
}
