import type { ParseResult } from '../workers/protocol/graph';
import type { Context } from './store';

export interface MergeSlice {
  /** The graph with its simple chains merged, while it is shown. */
  merged: { result: ParseResult; chains: number } | undefined;
  /** Merging was asked for: the merged graph is shown or on its way. */
  mergeOn: boolean;
  merging: boolean;
  /** Shows the graph with its simple chains merged, or the graph as loaded, and lays it out again. */
  setMerged: (on: boolean) => void;
  /** The shown graph as Bandage saves a GFA. */
  shownGfa: () => Promise<Blob>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createMergeSlice(ctx: Context): MergeSlice {
  const { set, get, services } = ctx;
  let request = 0;
  return {
    merged: undefined,
    mergeOn: false,
    merging: false,

    setMerged(on) {
      if (get().load.state !== 'loaded') return;
      const ticket = ++request;
      set({ merging: true, mergeOn: on });
      services.graph
        .merge(on)
        .then(async ({ result, map, chains }) => {
          await services.sequence.setChains(map);
          if (ticket !== request) return;
          set({ merged: result && { result, chains }, merging: false });
          get().resetColorRange();
          get().loadPaths();
          get().clearFilters();
          get().restartLayout();
        })
        .catch((error: unknown) => {
          if (ticket !== request) return;
          set({ merging: false, mergeOn: get().merged !== undefined });
          get().toast('Chains could not be merged', message(error));
        });
    },

    async shownGfa() {
      return services.sequence.gfa(await services.graph.gfa());
    },
  };
}
