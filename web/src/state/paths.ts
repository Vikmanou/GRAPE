import { type PathList, REVERSE_STEP } from '../workers/protocol/graph';
import type { Context } from './store';

export type PathsState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ready'; list: PathList }
  | { state: 'failed'; message: string };

export interface PathsSlice {
  paths: PathsState;
  /** Asks the graph worker for the loaded graph's P and W records. */
  loadPaths: () => void;
  /** Selects every segment the path visits and frames them. */
  selectPath: (path: number) => void;
}

export function segmentsOf(steps: Uint32Array): Uint32Array {
  return Uint32Array.from(steps, (step) => (step & ~REVERSE_STEP) >>> 0);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createPathsSlice(ctx: Context): PathsSlice {
  const { set, get, services } = ctx;
  let request = 0;
  return {
    paths: { state: 'none' },

    loadPaths() {
      const ticket = ++request;
      set({ paths: { state: 'loading' } });
      services.graph.paths().then(
        (list) => {
          if (ticket === request) set({ paths: { state: 'ready', list } });
        },
        (error: unknown) => {
          if (ticket === request) set({ paths: { state: 'failed', message: message(error) } });
        },
      );
    },

    selectPath(path) {
      services.graph.pathSteps(path).then(
        (steps) => {
          if (steps.length === 0) return;
          get().select(segmentsOf(steps), 'replace');
          get().zoomToSelection();
        },
        (error: unknown) => {
          get().toast('The path could not be read', message(error));
        },
      );
    },
  };
}
