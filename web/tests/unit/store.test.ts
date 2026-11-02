import { describe, expect, it } from 'vitest';
import type { EngineCommand, EngineEvent } from '../../src/engine/commands';
import type { EngineLike } from '../../src/state/bridge';
import { DEFAULT_SEED, listedHits, readHit } from '../../src/state/search';
import { createAppStore, type LayoutService, type Services } from '../../src/state/store';
import type { ParseResult } from '../../src/workers/protocol/graph';
import type { LayoutResponse } from '../../src/workers/protocol/layout';
import type { SearchResults } from '../../src/workers/protocol/sequence';
import { SearchCancelledError, WorkerTerminatedError } from '../../src/workers/rpc';

class FakeEngine implements EngineLike {
  readonly sent: EngineCommand[] = [];
  destroyed = false;
  private listener: ((event: EngineEvent) => void) | undefined;

  send(command: EngineCommand): void {
    this.sent.push(command);
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.listener = listener;
    return () => undefined;
  }

  destroy(): void {
    this.destroyed = true;
  }

  emit(event: EngineEvent): void {
    this.listener?.(event);
  }

  types(): string[] {
    return this.sent.map((c) => c.type);
  }
}

class FakeLayout implements LayoutService {
  listener: ((response: LayoutResponse) => void) | undefined;
  cancelled = false;
  packs: Float32Array[] = [];

  start(_mode: 'cpu' | 'gpu', _t: unknown, _o: unknown, listener: (response: LayoutResponse) => void): void {
    this.listener = listener;
  }

  pack(boxes: Float32Array<ArrayBuffer>): Promise<Float32Array> {
    this.packs.push(boxes);
    return Promise.resolve(new Float32Array(boxes.length / 2));
  }

  sentControls: unknown[] = [];

  send(request: unknown): void {
    this.sentControls.push(request);
  }

  memory() {
    return Promise.resolve({ wasm: 0, held: 0 });
  }

  cancel(): void {
    this.cancelled = true;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const result = { topology: {}, stats: { segments: 1, links: 0 } } as unknown as ParseResult;
const parsed = { result, sequences: { kind: 'dropped' } as const };
type Parsed = typeof parsed;
const geometry = {
  segments: 1,
  points: 2,
  pieces: new Uint32Array(2),
  links: new Uint32Array(0),
  segmentStarts: new Uint32Array(1),
  segmentPieces: Uint8Array.of(1),
};
const progress = { iteration: 10, total: 10, level: 0, levels: 1, energy: 0, done: true };
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const parses: ReturnType<typeof deferred<Parsed>>[] = [];
  const layouts: FakeLayout[] = [];
  const engines: FakeEngine[] = [];
  let cancels = 0;
  const loadedSources: unknown[] = [];
  const builds: number[] = [];
  let searching = deferred<SearchResults>();
  const services: Services = {
    sequence: {
      load: (source) => {
        loadedSources.push(source);
        return Promise.resolve();
      },
      preview: () => Promise.reject(new Error('unused')),
      sequence: () => Promise.reject(new Error('unused')),
      rawLine: () => Promise.reject(new Error('unused')),
      fasta: () => Promise.reject(new Error('unused')),
      setChains: () => Promise.reject(new Error('unused')),
      gfa: () => Promise.reject(new Error('unused')),
      memory: () => Promise.reject(new Error('unused')),
      buildIndex: (k) => {
        builds.push(k);
        return Promise.resolve({ k, guaranteedMatch: k, segments: 1, bases: 100, bytes: 1000 });
      },
      search: () => {
        searching = deferred<SearchResults>();
        return searching.promise;
      },
      cancelSearch: () => {
        searching.reject(new SearchCancelledError());
        return Promise.resolve();
      },
    },
    graph: {
      ping: () => Promise.resolve({ coreVersion: 'test', roundTripMs: 1 }),
      parse: () => {
        const parse = deferred<Parsed>();
        parses.push(parse);
        return parse.promise;
      },
      info: () => Promise.reject(new Error('unused')),
      summary: () => Promise.reject(new Error('unused')),
      find: () => Promise.reject(new Error('unused')),
      exportRecords: () => Promise.reject(new Error('unused')),
      labelSizes: () => Promise.reject(new Error('unused')),
      labelText: () => Promise.reject(new Error('unused')),
      distances: () => Promise.reject(new Error('unused')),
      paths: () => Promise.reject(new Error('unused')),
      pathSteps: () => Promise.reject(new Error('unused')),
      searchLinks: () =>
        Promise.resolve({
          from: new Uint32Array(0),
          to: new Uint32Array(0),
          bits: new Uint8Array(0),
          overlapFrom: new Uint32Array(0),
          overlapTo: new Uint32Array(0),
        }),
      names: (segments) => Promise.resolve(Array.from(segments, (s) => `s${s}`)),
      merge: () => Promise.reject(new Error('unused')),
      addFasta: () => Promise.reject(new Error('unused')),
      gfa: () => Promise.reject(new Error('unused')),
      memory: () => Promise.reject(new Error('unused')),
      cancel: () => {
        cancels++;
        for (const p of parses) p.reject(new WorkerTerminatedError('graph'));
      },
    },
    layoutClient: () => {
      const layout = new FakeLayout();
      layouts.push(layout);
      return layout;
    },
    createEngine: () => {
      const engine = new FakeEngine();
      engines.push(engine);
      return Promise.resolve(engine);
    },
    detectBackend: () => Promise.resolve('webgpu'),
    search: '',
  };
  const store = createAppStore(services);
  return {
    store,
    parses,
    layouts,
    engines,
    loadedSources,
    builds,
    cancels: () => cancels,
    finishSearch: (r: SearchResults) => {
      searching.resolve(r);
    },
  };
}

async function loadedWithEngine() {
  const s = setup();
  const app = s.store.getState();
  await app.detectRenderer();
  await app.attachEngine({} as HTMLElement);
  app.open(new File(['S\ta\t*'], 'a.gfa'));
  s.parses[0]?.resolve(parsed);
  await flush();
  return s;
}

describe('store', () => {
  it('starts a GPU layout once the file is loaded and the engine attached', async () => {
    const { store, layouts, engines, loadedSources } = await loadedWithEngine();
    expect(store.getState().load.state).toBe('loaded');
    expect(loadedSources).toEqual([parsed.sequences]);
    const layout = layouts.at(-1);
    const engine = engines[0];
    if (!layout || !engine) throw new Error('no layout or engine');
    layout.listener?.({ type: 'geometry', id: 1, geometry, totalIterations: 10 });
    layout.listener?.({
      type: 'hierarchy',
      id: 1,
      hierarchy: { levels: [], start: new Float32Array(), frozen: new Uint8Array() },
    });
    expect(engine.types()).toEqual([
      'set-theme',
      'set-display',
      'set-label-options',
      'set-insets',
      'set-display',
      'set-filter',
      'set-graph',
      'set-label-sizes',
      'start-layout',
    ]);
    expect(store.getState().layoutStatus).toEqual({ state: 'running', iteration: 0, total: 10 });

    engine.emit({ type: 'layout-measured', boxes: new Float32Array(4), progress });
    await flush();
    expect(layout.packs).toHaveLength(1);
    expect(engine.types()).toContain('set-offsets');
    expect(store.getState().layoutStatus.state).toBe('done');
  });

  it('warns when a graph is above the v1 ceiling', async () => {
    const { store, parses } = setup();
    store.getState().open(new File([''], 'big.gfa'));
    const big = { ...result, stats: { ...result.stats, segments: 1_000_001 } };
    parses[0]?.resolve({ ...parsed, result: big });
    await flush();
    expect(store.getState().toasts.map((t) => t.message)).toEqual(['This graph is larger than GRAPE is built for']);
  });

  it('restarts the layout when the options change', async () => {
    const { store, layouts } = await loadedWithEngine();
    const first = layouts.at(-1);
    store.getState().setLayoutOptions({ seed: 7, quality: 'fast' });
    expect(first?.cancelled).toBe(true);
    expect(layouts.at(-1)).not.toBe(first);
    expect(store.getState().layoutOptions.seed).toBe(7);
  });

  it('a newer file replaces one still parsing', async () => {
    const { store, parses, cancels } = setup();
    store.getState().open(new File(['a'], 'first.gfa'));
    store.getState().open(new File(['b'], 'second.gfa'));
    expect(cancels()).toBe(1);
    parses[1]?.resolve(parsed);
    await flush();
    const load = store.getState().load;
    expect(load.state === 'loaded' && load.file.name).toBe('second.gfa');
  });

  it('cancelling a parse returns to idle and ignores its result', async () => {
    const { store } = setup();
    store.getState().open(new File(['a'], 'a.gfa'));
    store.getState().cancelLoad();
    await flush();
    expect(store.getState().load.state).toBe('idle');
  });

  it('a lost device reports an error and drops the engine and its layout', async () => {
    const { store, engines, layouts } = await loadedWithEngine();
    engines[0]?.emit({ type: 'device-lost', message: 'gone' });
    expect(store.getState().engineError).toBe('GPU device lost: gone');
    expect(engines[0]?.destroyed).toBe(true);
    expect(layouts.at(-1)?.cancelled).toBe(true);
    expect(store.getState().layoutStatus.state).toBe('idle');
  });

  it('panel insets measured before the engine exists reach it when it attaches', async () => {
    const { store, engines } = setup();
    const insets = { top: 40, right: 0, bottom: 28, left: 330 };
    store.getState().setInsets(insets);
    await store.getState().attachEngine({} as HTMLElement);
    expect(engines[0]?.sent).toContainEqual({ type: 'set-insets', insets });
  });

  it('an engine that arrives after detaching is destroyed', async () => {
    const { store, engines } = setup();
    const attaching = store.getState().attachEngine({} as HTMLElement);
    store.getState().detachEngine();
    await attaching;
    expect(engines[0]?.destroyed).toBe(true);
  });

  describe('sequence search', () => {
    const results: SearchResults = {
      names: ['gene'],
      lengths: Uint32Array.of(100),
      totals: Uint32Array.of(2),
      // query, score, q_start, q_end, matches, columns, parts
      hits: Uint32Array.of(0, 180, 0, 100, 95, 100, 2, 0, 60, 10, 40, 30, 30, 1),
      // segment, reverse, q_start, q_end, start, end
      parts: Uint32Array.of(3, 0, 0, 60, 5, 65, 4, 1, 60, 100, 0, 40, 7, 0, 10, 40, 0, 30),
      tooShort: [],
      repeats: 0,
      seedsCut: false,
    };

    it('indexes on first use, reads hits back, and keeps the index for the next search', async () => {
      const { store, builds, finishSearch } = await loadedWithEngine();
      store.getState().runSearch('ACGT');
      expect(store.getState().searchRun.state).toBe('indexing');
      await flush();
      finishSearch(results);
      await flush();
      const app = store.getState();
      expect(app.searchRun.state).toBe('done');
      expect(builds).toEqual([DEFAULT_SEED]);
      expect(listedHits(results, undefined)).toEqual([0, 1]);
      const starts = app.searchPartStarts ?? new Uint32Array();
      expect(readHit(results, starts, 0)).toEqual({
        index: 0,
        query: 0,
        score: 180,
        coverage: 1,
        identity: 0.95,
        parts: [
          { segment: 3, reverse: false, start: 5, end: 65 },
          { segment: 4, reverse: true, start: 0, end: 40 },
        ],
      });
      expect(readHit(results, starts, 1).parts).toEqual([{ segment: 7, reverse: false, start: 0, end: 30 }]);
      expect(app.searchNames.get(4)).toBe('s4');
      store.getState().runSearch('ACGT');
      await flush();
      expect(builds).toEqual([DEFAULT_SEED]);
      expect(store.getState().searchRun.state).toBe('searching');
    });

    it('indexes again for a new seed length or a new graph', async () => {
      const { store, builds, parses, finishSearch } = await loadedWithEngine();
      store.getState().setSearchSeed(11);
      store.getState().runSearch('ACGT');
      await flush();
      finishSearch(results);
      await flush();
      expect(builds).toEqual([11]);
      store.getState().open(new File(['S\tb\t*'], 'b.gfa'));
      expect(store.getState().searchResults).toBeUndefined();
      expect(store.getState().searchIndex).toBeUndefined();
      parses[1]?.resolve(parsed);
      await flush();
      store.getState().runSearch('ACGT');
      await flush();
      expect(builds).toEqual([11, 11]);
    });

    it('goes back to idle on cancel and keeps the index', async () => {
      const { store } = await loadedWithEngine();
      store.getState().runSearch('ACGT');
      await flush();
      store.getState().cancelSearch();
      await flush();
      expect(store.getState().searchRun.state).toBe('idle');
      expect(store.getState().searchIndex?.k).toBe(DEFAULT_SEED);
    });
  });
});
