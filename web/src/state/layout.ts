import { useEffect, useRef, useState } from 'react';
import { LayoutClient } from '../workers/LayoutClient';
import type { Geometry, Topology } from '../workers/protocol';

/** Fixed until the layout controls (milestone 3) let the user pick one. */
export const DEFAULT_SEED = 1;

const IDLE = { state: 'idle' } as const;

export type LayoutStatus =
  | { state: 'idle' }
  | { state: 'running'; iteration: number; total: number }
  | { state: 'done'; total: number; ms: number }
  | { state: 'failed'; message: string };

/** Where layout output goes: the renderer, once it exists. */
export interface LayoutSink {
  geometry(geometry: Geometry): void;
  positions(positions: Float32Array): void;
}

/**
 * Lays out each new topology in the layout worker and streams the result to
 * `sink`. A sink that arrives late gets the latest geometry and positions.
 */
export function useLayout(topology: Topology | undefined, sink: LayoutSink | undefined): LayoutStatus {
  // Tagged with its topology, so a stale run reads as idle without an effect resetting it.
  const [run, setRun] = useState<{ topology?: Topology; status: LayoutStatus }>({ status: IDLE });
  const latest = useRef<{ geometry?: Geometry; positions?: Float32Array }>({});
  const sinkRef = useRef(sink);

  useEffect(() => {
    sinkRef.current = sink;
    const { geometry, positions } = latest.current;
    if (sink && geometry) {
      sink.geometry(geometry);
      if (positions) sink.positions(positions);
    }
  }, [sink]);

  useEffect(() => {
    latest.current = {};
    if (!topology) return;
    const setStatus = (status: LayoutStatus) => {
      setRun({ topology, status });
    };
    const client = new LayoutClient();
    const start = performance.now();
    let total = 0;
    client.start(topology, DEFAULT_SEED, (response) => {
      switch (response.type) {
        case 'geometry':
          total = response.totalIterations;
          latest.current = { geometry: response.geometry };
          sinkRef.current?.geometry(response.geometry);
          setStatus({ state: 'running', iteration: 0, total });
          break;
        case 'positions':
          latest.current.positions = response.positions;
          sinkRef.current?.positions(response.positions);
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
      client.cancel();
    };
  }, [topology]);

  return run.topology === topology ? run.status : IDLE;
}
