import { parseFindQuery } from '../workers/graph/findQuery';
import type { Context } from './store';

export type FindResult =
  | { state: 'idle' }
  | { state: 'searching' }
  | { state: 'done'; found: number; missing: string[] }
  | { state: 'failed'; message: string };

export interface FindSlice {
  findResult: FindResult;
  /** Selects the segments a list of names or a regex names, frames them and lists the names not found. */
  find: (text: string, regex: boolean) => void;
}

export function createFindSlice(ctx: Context): FindSlice {
  const { set, get, services } = ctx;
  let request = 0;
  return {
    findResult: { state: 'idle' },
    find(text, regex) {
      const query = parseFindQuery(text, regex);
      if (!query || get().load.state !== 'loaded') return;
      const ticket = ++request;
      set({ findResult: { state: 'searching' } });
      services.graph.find(query).then(
        ({ segments, missing }) => {
          if (ticket !== request) return;
          set({ findResult: { state: 'done', found: segments.length, missing } });
          if (segments.length === 0) return;
          get().select(segments, 'replace');
          get().zoomToSelection();
        },
        (error: unknown) => {
          if (ticket !== request) return;
          set({ findResult: { state: 'failed', message: error instanceof Error ? error.message : String(error) } });
        },
      );
    },
  };
}
