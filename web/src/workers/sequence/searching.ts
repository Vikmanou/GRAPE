import { type SearchIndex, SearchIndexBuilder } from '../../wasm/pkg/gfa_wasm';
import { detectCompression, readFile } from '../graph/readFile';
import {
  HIT_WORDS,
  PART_WORDS,
  resultTransfers,
  type SearchLinks,
  type SearchResults,
  type SequenceResponse,
} from '../protocol/sequence';
import { MAX_TOTAL_BASES, parseQueries } from './queries';

/** How often long work lets the worker hear a cancel and reports progress. */
const YIELD_MS = 50;
const STEP_BASES = 1 << 22;

interface Source {
  readonly count: number;
  length(segment: number): number;
  allBases(): AsyncGenerator<[number, Uint8Array]>;
}

const pause = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

async function queryText(queries: string | Blob): Promise<string> {
  if (typeof queries === 'string') return queries;
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  await readFile(
    queries,
    await detectCompression(queries),
    (chunk) => {
      bytes += chunk.length;
      // Line ends and headers leave room over the bases themselves.
      if (bytes > 2 * MAX_TOTAL_BASES) throw new Error('The query file is larger than one search may hold.');
      parts.push(decoder.decode(chunk, { stream: true }));
    },
    () => undefined,
  );
  parts.push(decoder.decode());
  return parts.join('');
}

function concat(arrays: Uint32Array[]): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(arrays.reduce((n, a) => n + a.length, 0));
  let at = 0;
  for (const a of arrays) {
    out.set(a, at);
    at += a.length;
  }
  return out;
}

/** The sequence worker's index and the runs over it. One run at a time. */
export class Searching {
  private index: SearchIndex | undefined;
  /** Moves on to stop whatever run holds an older value. */
  private run = 0;

  constructor(private readonly post: (message: SequenceResponse, transfer?: Transferable[]) => void) {}

  /** New sequences: the index no longer describes them. */
  drop(): void {
    this.run++;
    this.index?.free();
    this.index = undefined;
  }

  cancel(): void {
    this.run++;
  }

  async build(id: number, source: Source, k: number, links: SearchLinks): Promise<void> {
    this.drop();
    const run = this.run;
    const builder = new SearchIndexBuilder(source.count, k);
    let total = 0;
    for (let segment = 0; segment < source.count; segment++) total += source.length(segment);
    let added = 0;
    let last = performance.now();
    const paused = async (fraction: number): Promise<boolean> => {
      if (performance.now() - last < YIELD_MS) return this.run === run;
      this.post({ type: 'index-progress', id, fraction });
      await pause();
      last = performance.now();
      return this.run === run;
    };
    let live = true;
    try {
      for await (const [segment, bases] of source.allBases()) {
        builder.add(segment, bases);
        added += bases.length;
        live = await paused(total > 0 ? added / total / 2 : 0);
        if (!live) break;
      }
      if (live) builder.plan();
      while (live && !builder.step(STEP_BASES)) live = await paused(0.5 + builder.progress() / 2);
    } catch (error) {
      builder.free();
      throw error;
    }
    if (!live || this.run !== run) {
      builder.free();
      this.post({ type: 'cancelled', id });
      return;
    }
    const index = builder.finish(links.from, links.to, links.bits, links.overlapFrom, links.overlapTo);
    this.index = index;
    this.post({
      type: 'index-built',
      id,
      info: {
        k: index.k(),
        guaranteedMatch: index.guaranteedMatch(),
        segments: index.indexedSegments(),
        bases: index.indexedBases(),
        bytes: index.heapBytes(),
      },
    });
  }

  async search(id: number, queries: string | Blob): Promise<void> {
    const index = this.index;
    if (!index) throw new Error('The sequences have not been indexed.');
    const run = this.run;
    const text = await queryText(queries);
    const { queries: parsed, tooShort } = parseQueries(text, index.k());
    const lengths = new Uint32Array(parsed.length);
    const totals = new Uint32Array(parsed.length);
    const hitArrays: Uint32Array[] = [];
    const partArrays: Uint32Array[] = [];
    let repeats = 0;
    let seedsCut = false;
    for (const [q, query] of parsed.entries()) {
      await pause();
      if (this.run !== run) {
        this.post({ type: 'cancelled', id });
        return;
      }
      this.post({ type: 'search-progress', id, done: q, total: parsed.length });
      const found = index.search(query.bases);
      lengths[q] = query.bases.length;
      totals[q] = found.total();
      repeats += found.repeats();
      seedsCut ||= found.seedsCut();
      const hits = found.hits();
      const count = hits.length / (HIT_WORDS - 1);
      const words = new Uint32Array(count * HIT_WORDS);
      for (let h = 0; h < count; h++) {
        words[h * HIT_WORDS] = q;
        words.set(hits.subarray(h * (HIT_WORDS - 1), (h + 1) * (HIT_WORDS - 1)), h * HIT_WORDS + 1);
      }
      hitArrays.push(words);
      partArrays.push(found.parts());
      found.free();
    }
    const results: SearchResults = {
      names: parsed.map((q) => q.name),
      lengths,
      totals,
      hits: concat(hitArrays),
      parts: concat(partArrays),
      tooShort,
      repeats,
      seedsCut,
    };
    if (results.parts.length % PART_WORDS !== 0) throw new Error('search parts are misaligned');
    this.post({ type: 'searched', id, results }, resultTransfers(results));
  }
}
