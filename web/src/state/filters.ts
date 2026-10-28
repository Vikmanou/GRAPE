import type { Filter } from '../engine/core/Visibility';
import { shownGraph } from './load';
import type { Context } from './store';

export interface Filters {
  /** Steps from the selection when the filter was turned on, and the most steps shown. */
  neighbourhood: { distances: Uint8Array; steps: number } | undefined;
  /** 1 per component rank touched by the selection when the filter was turned on. */
  components: Uint8Array | undefined;
  /** 0 shows components of any size. */
  minComponentLength: number;
  depth: { min: number; max: number } | undefined;
}

export const NO_FILTERS: Filters = {
  neighbourhood: undefined,
  components: undefined,
  minComponentLength: 0,
  depth: undefined,
};

export interface FilterSlice {
  filters: Filters;
  /** Segments the filters leave shown; undefined while nothing is filtered. */
  visibleSegments: number | undefined;
  /** Shows only segments within `steps` of the current selection. */
  showNeighbourhood: (steps: number) => void;
  setNeighbourhoodSteps: (steps: number) => void;
  /** Shows only the components the current selection touches. */
  showSelectedComponents: () => void;
  setFilters: (patch: Partial<Filters>) => void;
  clearFilters: () => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createFilterSlice(ctx: Context): FilterSlice {
  const { set, get, services } = ctx;
  let request = 0;

  function apply(filters: Filters): void {
    set({ filters });
    const { neighbourhood, components, minComponentLength, depth } = filters;
    const lengths = minComponentLength > 0 ? shownGraph(get())?.components.lengths : undefined;
    const filter: Filter = {
      neighbourhood,
      components,
      minComponentLength: lengths && { bases: minComponentLength, lengths },
      depth,
    };
    ctx.bridge.send({ type: 'set-filter', filter });
  }

  return {
    filters: NO_FILTERS,
    visibleSegments: undefined,

    showNeighbourhood(steps) {
      const { bits, count } = get().selection;
      if (count === 0) return;
      const ticket = ++request;
      services.graph.distances(bits.slice()).then(
        (distances) => {
          if (ticket === request) apply({ ...get().filters, neighbourhood: { distances, steps } });
        },
        (error: unknown) => {
          get().toast('The neighbourhood could not be found', message(error));
        },
      );
    },

    setNeighbourhoodSteps(steps) {
      const neighbourhood = get().filters.neighbourhood;
      if (neighbourhood) apply({ ...get().filters, neighbourhood: { ...neighbourhood, steps } });
    },

    showSelectedComponents() {
      const graph = shownGraph(get());
      const { bits, count } = get().selection;
      if (!graph || count === 0) return;
      const ranks = graph.topology.components;
      const shown = new Uint8Array(graph.components.segments.length);
      for (const [w, word] of bits.entries()) {
        for (let b = 0, rest = word; rest !== 0; b++, rest >>>= 1) {
          if (rest & 1) shown[ranks[w * 32 + b] ?? 0] = 1;
        }
      }
      apply({ ...get().filters, components: shown });
    },

    setFilters(patch) {
      if ('neighbourhood' in patch) request++;
      apply({ ...get().filters, ...patch });
    },

    clearFilters() {
      request++;
      apply(NO_FILTERS);
    },
  };
}
