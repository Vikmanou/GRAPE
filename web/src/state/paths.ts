import { pathColor } from '../engine/style/colors';
import { type PathList, REVERSE_STEP } from '../workers/protocol/graph';
import { shownGraph } from './load';
import type { Context } from './store';

export type PathsState =
  | { state: 'none' }
  | { state: 'loading' }
  | { state: 'ready'; list: PathList }
  | { state: 'failed'; message: string };

export interface PathsSlice {
  paths: PathsState;
  /** Paths drawn in their own colours, in the order they were highlighted. */
  highlightedPaths: number[];
  /** Each segment's colour in the path mode, from the first highlighted path that visits it. */
  pathColors: Uint32Array<ArrayBuffer> | undefined;
  /** Asks the graph worker for the loaded graph's P and W records. */
  loadPaths: () => void;
  /** Highlights a path, switching to the path colour mode, or stops highlighting it. */
  toggleHighlight: (path: number) => void;
  clearHighlights: () => void;
  /** Selects every segment the path visits and frames them. */
  selectPath: (path: number) => void;
  /** The path being stepped through and the step selected, from 0. */
  pathStep: PathStep | undefined;
  /** Selects one step of a path, clamped to its steps, and centres the camera on it. */
  stepPath: (path: number, step: number) => void;
  stopStepping: () => void;
}

export interface PathStep {
  path: number;
  step: number;
  count: number;
  reverse: boolean;
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
  let steps = new Map<number, Promise<Uint32Array<ArrayBuffer>>>();

  const stepsOf = (path: number) => {
    let found = steps.get(path);
    if (!found) {
      found = services.graph.pathSteps(path);
      steps.set(path, found);
    }
    return found;
  };

  async function recolor(highlighted: number[]): Promise<void> {
    const segments = shownGraph(get())?.topology.lengths.length ?? 0;
    const all = await Promise.all(highlighted.map(stepsOf));
    if (get().highlightedPaths !== highlighted) return;
    const colors = new Uint32Array(segments);
    for (const [k, path] of highlighted.entries()) {
      const color = pathColor(path);
      for (const step of all[k] ?? []) {
        const segment = (step & ~REVERSE_STEP) >>> 0;
        if (segment < segments && colors[segment] === 0) colors[segment] = color;
      }
    }
    set({ pathColors: colors });
    ctx.bridge.send({ type: 'set-path-colors', colors });
  }

  function highlight(highlightedPaths: number[]): void {
    set({ highlightedPaths });
    if (highlightedPaths.length > 0 && get().displayOptions.color !== 'path') get().setColorMode('path');
    recolor(highlightedPaths).catch((error: unknown) => {
      get().toast('The path could not be read', message(error));
    });
  }

  return {
    paths: { state: 'none' },
    highlightedPaths: [],
    pathColors: undefined,
    pathStep: undefined,

    loadPaths() {
      const ticket = ++request;
      steps = new Map();
      set({ paths: { state: 'loading' }, highlightedPaths: [], pathColors: undefined, pathStep: undefined });
      services.graph.paths().then(
        (list) => {
          if (ticket === request) set({ paths: { state: 'ready', list } });
        },
        (error: unknown) => {
          if (ticket === request) set({ paths: { state: 'failed', message: message(error) } });
        },
      );
    },

    toggleHighlight(path) {
      const current = get().highlightedPaths;
      highlight(current.includes(path) ? current.filter((p) => p !== path) : [...current, path]);
    },

    clearHighlights() {
      highlight([]);
    },

    stepPath(path, step) {
      stepsOf(path).then(
        (all) => {
          if (all.length === 0) return;
          const at = Math.max(0, Math.min(step, all.length - 1));
          const value = all[at] ?? 0;
          set({ pathStep: { path, step: at, count: all.length, reverse: (value & REVERSE_STEP) !== 0 } });
          get().select(Uint32Array.of((value & ~REVERSE_STEP) >>> 0), 'replace');
          ctx.bridge.send({ type: 'zoom-to-selection', follow: true });
        },
        (error: unknown) => {
          get().toast('The path could not be read', message(error));
        },
      );
    },

    stopStepping() {
      set({ pathStep: undefined });
    },

    selectPath(path) {
      stepsOf(path).then(
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
