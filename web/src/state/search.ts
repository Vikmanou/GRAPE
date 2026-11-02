import { HIT_WORDS, type IndexInfo, PART_WORDS, type SearchResults } from '../workers/protocol/sequence';
import { SearchCancelledError } from '../workers/rpc';
import type { Context } from './store';

export const DEFAULT_SEED = 15;
export const MIN_SEED = 8;
export const MAX_SEED = 16;
/** Hits listed per query; the rest are drawn and counted. */
export const SHOWN_HITS = 200;

export type SearchRun =
  | { state: 'idle' }
  | { state: 'indexing'; fraction: number }
  | { state: 'searching'; done: number; total: number }
  | { state: 'done' }
  | { state: 'failed'; message: string };

export interface SearchHit {
  /** Its place among every hit found. */
  index: number;
  query: number;
  score: number;
  /** Bases of the query the hit spans, over the query's length. */
  coverage: number;
  /** Matches over matches, mismatches and gap bases, as BLAST counts it. */
  identity: number;
  parts: SearchPart[];
}

export interface SearchPart {
  segment: number;
  reverse: boolean;
  /** On the segment's forward strand, from 0, the end exclusive. */
  start: number;
  end: number;
}

export interface SearchSlice {
  searchRun: SearchRun;
  searchIndex: IndexInfo | undefined;
  searchResults: SearchResults | undefined;
  /** First part of each hit, then the end of the last. */
  searchPartStarts: Uint32Array | undefined;
  /** Names of the segments in the hits listed. */
  searchNames: Map<number, string>;
  searchSeed: number;
  /** Seed length; a new one indexes again at the next search. */
  setSearchSeed: (k: number) => void;
  /** Indexes the shown graph if it has no index yet, then searches for pasted text or a FASTA file. */
  runSearch: (queries: string | Blob) => void;
  cancelSearch: () => void;
  /** Forgets the index and the hits, for a new graph or new sequences. */
  clearSearch: () => void;
  /** Selects the hit's segments and frames them. */
  zoomToHit: (hit: number) => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Each hit's first part, then the end of the last. */
function partStarts(results: SearchResults): Uint32Array<ArrayBuffer> {
  const count = results.hits.length / HIT_WORDS;
  const starts = new Uint32Array(count + 1);
  for (let h = 0; h < count; h++) starts[h + 1] = (starts[h] ?? 0) + (results.hits[h * HIT_WORDS + 6] ?? 0);
  return starts;
}

export function readHit(results: SearchResults, starts: Uint32Array, index: number): SearchHit {
  const at = index * HIT_WORDS;
  const word = (k: number) => results.hits[at + k] ?? 0;
  const query = word(0);
  const parts: SearchPart[] = [];
  for (let p = starts[index] ?? 0; p < (starts[index + 1] ?? 0); p++) {
    const part = (k: number) => results.parts[p * PART_WORDS + k] ?? 0;
    parts.push({ segment: part(0), reverse: part(1) === 1, start: part(4), end: part(5) });
  }
  const columns = word(5);
  return {
    index,
    query,
    score: word(1) | 0,
    coverage: (word(3) - word(2)) / Math.max(1, results.lengths[query] ?? 1),
    identity: columns > 0 ? word(4) / columns : 0,
    parts,
  };
}

/** The hits a query's table lists: the first of that query's hits, up to `SHOWN_HITS`. */
export function listedHits(results: SearchResults, query: number | undefined): number[] {
  const out: number[] = [];
  const perQuery = new Map<number, number>();
  const count = results.hits.length / HIT_WORDS;
  for (let h = 0; h < count; h++) {
    const q = results.hits[h * HIT_WORDS] ?? 0;
    const seen = perQuery.get(q) ?? 0;
    perQuery.set(q, seen + 1);
    if (seen < SHOWN_HITS && (query === undefined || q === query)) out.push(h);
  }
  return out;
}

export function createSearchSlice(ctx: Context): SearchSlice {
  const { set, get, services } = ctx;
  let request = 0;

  async function run(ticket: number, queries: string | Blob): Promise<void> {
    const { searchIndex, searchSeed } = get();
    if (searchIndex?.k !== searchSeed) {
      set({ searchRun: { state: 'indexing', fraction: 0 }, searchIndex: undefined });
      const links = await services.graph.searchLinks();
      if (ticket !== request) return;
      const info = await services.sequence.buildIndex(searchSeed, links, (fraction) => {
        if (ticket === request) set({ searchRun: { state: 'indexing', fraction } });
      });
      if (ticket !== request) return;
      if (info.segments === 0) throw new Error('This graph has no sequences to search.');
      set({ searchIndex: info });
    }
    set({ searchRun: { state: 'searching', done: 0, total: 1 } });
    const results = await services.sequence.search(queries, (done, total) => {
      if (ticket === request) set({ searchRun: { state: 'searching', done, total } });
    });
    if (ticket !== request) return;
    const starts = partStarts(results);
    const named = new Set<number>();
    for (const h of listedHits(results, undefined)) {
      for (const part of readHit(results, starts, h).parts) named.add(part.segment);
    }
    const segments = Uint32Array.from(named);
    const names = await services.graph.names(segments);
    if (ticket !== request) return;
    set({
      searchRun: { state: 'done' },
      searchResults: results,
      searchPartStarts: starts,
      searchNames: new Map(Array.from(segments, (segment, i) => [segment, names[i] ?? ''])),
    });
  }

  const forget = () => ({
    searchRun: { state: 'idle' } as const,
    searchResults: undefined,
    searchPartStarts: undefined,
    searchNames: new Map<number, string>(),
  });

  return {
    ...forget(),
    searchIndex: undefined,
    searchSeed: DEFAULT_SEED,

    setSearchSeed(k) {
      set({ searchSeed: Math.max(MIN_SEED, Math.min(MAX_SEED, Math.round(k))) });
    },

    runSearch(queries) {
      if (get().load.state !== 'loaded' || get().merging) return;
      const state = get().searchRun.state;
      if (state === 'indexing' || state === 'searching') void services.sequence.cancelSearch();
      const ticket = ++request;
      set(forget());
      run(ticket, queries).catch((error: unknown) => {
        if (ticket !== request || error instanceof SearchCancelledError) return;
        set({ searchRun: { state: 'failed', message: message(error) } });
      });
    },

    cancelSearch() {
      request++;
      set({ searchRun: { state: 'idle' } });
      services.sequence.cancelSearch().catch((error: unknown) => {
        get().toast('The search could not be cancelled', message(error));
      });
    },

    clearSearch() {
      request++;
      set({ ...forget(), searchIndex: undefined });
    },

    zoomToHit(hit) {
      const { searchResults, searchPartStarts } = get();
      if (!searchResults || !searchPartStarts) return;
      const { parts } = readHit(searchResults, searchPartStarts, hit);
      get().select(Uint32Array.from(new Set(parts.map((p) => p.segment))), 'replace');
      get().zoomToSelection();
    },
  };
}
