import type { FastaAttached, ParseResult } from '../workers/protocol/graph';
import { WorkerTerminatedError } from '../workers/rpc';
import { EXAMPLES, fetchExample } from './examples';
import type { MergeSlice } from './merge';
import type { Context } from './store';

/** The v1 ceiling (spec, Overview); larger graphs load with a warning. */
const MAX_SEGMENTS = 1_000_000;
const MAX_LINKS = 1_500_000;

export interface FileInfo {
  name: string;
  size: number;
}

export type LoadState =
  | { state: 'idle' }
  | { state: 'parsing'; file: FileInfo; fraction: number }
  | { state: 'loaded'; file: FileInfo; result: ParseResult }
  | { state: 'failed'; file: FileInfo; message: string };

export type SequenceFileState =
  | { state: 'none' }
  | { state: 'reading'; name: string; fraction: number }
  | { state: 'added'; name: string; attached: FastaAttached }
  | { state: 'failed'; name: string; message: string };

export type CoreStatus =
  | { state: 'loading' }
  | { state: 'ready'; version: string; roundTripMs: number }
  | { state: 'error'; message: string };

export interface FileSlice {
  core: CoreStatus;
  load: LoadState;
  startCore: () => void;
  /** A newer file replaces one still parsing. */
  open: (file: File) => void;
  /** Opens one of the bundled examples, by id. */
  openExample: (id: string) => void;
  cancelLoad: () => void;
  sequenceFile: SequenceFileState;
  /** Sequences for a graph whose file has none, from a FASTA file naming its segments. */
  addSequences: (file: File) => void;
}

/** The graph on screen: as loaded, or with its chains merged. */
export function shownGraph(state: Pick<FileSlice, 'load'> & Pick<MergeSlice, 'merged'>): ParseResult | undefined {
  return state.load.state === 'loaded' ? (state.merged?.result ?? state.load.result) : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createFileSlice(ctx: Context): FileSlice {
  const { set, get, services } = ctx;
  let parsing: File | undefined;

  return {
    core: { state: 'loading' },
    load: { state: 'idle' },
    sequenceFile: { state: 'none' },

    startCore() {
      services.graph.ping().then(
        ({ coreVersion, roundTripMs }) => {
          set({ core: { state: 'ready', version: coreVersion, roundTripMs } });
        },
        (error: unknown) => {
          if (!(error instanceof WorkerTerminatedError)) set({ core: { state: 'error', message: message(error) } });
        },
      );
    },

    openExample(id) {
      const example = EXAMPLES.find((e) => e.id === id);
      if (!example) return;
      fetchExample(example, import.meta.env.BASE_URL).then(
        (file) => {
          get().open(file);
        },
        (error: unknown) => {
          get().toast(`Could not load the ${example.title} example`, message(error));
        },
      );
    },

    open(file) {
      const graph = services.graph;
      if (parsing) graph.cancel();
      parsing = file;
      get().stopLayout();
      const info = { name: file.name, size: file.size };
      set({
        load: { state: 'parsing', file: info, fraction: 0 },
        findResult: { state: 'idle' },
        merged: undefined,
        mergeOn: false,
        sequenceFile: { state: 'none' },
      });
      graph
        .parse(file, (bytesRead, totalBytes) => {
          if (parsing !== file) return;
          set({ load: { state: 'parsing', file: info, fraction: totalBytes > 0 ? bytesRead / totalBytes : 0 } });
        })
        .then(
          ({ result, sequences }) => {
            if (parsing !== file) return;
            parsing = undefined;
            set({ load: { state: 'loaded', file: info, result } });
            get().resetColorRange();
            get().loadPaths();
            get().clearFilters();
            const { segments, links } = result.stats;
            if (segments > MAX_SEGMENTS || links > MAX_LINKS) {
              get().toast(
                'This graph is larger than GRAPE is built for',
                `GRAPE is tested up to ${MAX_SEGMENTS.toLocaleString('en')} segments and ${MAX_LINKS.toLocaleString('en')} links; this one has ${segments.toLocaleString('en')} and ${links.toLocaleString('en')}. It may be slow or run out of memory.`,
              );
            }
            services.sequence.load(sequences).catch((error: unknown) => {
              get().toast('Sequences could not be loaded', message(error));
            });
            get().restartLayout();
          },
          (error: unknown) => {
            if (error instanceof WorkerTerminatedError || parsing !== file) return;
            parsing = undefined;
            set({ load: { state: 'failed', file: info, message: message(error) } });
          },
        );
    },

    addSequences(file) {
      const { load, merged } = get();
      if (load.state !== 'loaded') return;
      const name = file.name;
      set({ sequenceFile: { state: 'reading', name, fraction: 0 } });
      services.graph
        .addFasta(file, (bytesRead, totalBytes) => {
          if (get().sequenceFile.state !== 'reading') return;
          set({ sequenceFile: { state: 'reading', name, fraction: totalBytes > 0 ? bytesRead / totalBytes : 0 } });
        })
        .then(async ({ result, sequences, attached }) => {
          if (get().load !== load) return;
          set({
            load: { ...load, result },
            merged: undefined,
            mergeOn: false,
            sequenceFile: { state: 'added', name, attached },
          });
          await services.sequence.load(sequences);
          get().resetColorRange();
          // New lengths change the layout; new GC only colours.
          if (attached.resized > 0 || merged) get().restartLayout();
          else ctx.bridge.send({ type: 'set-gc', gc: result.attributes.gc });
        })
        .catch((error: unknown) => {
          if (error instanceof WorkerTerminatedError) return;
          set({ sequenceFile: { state: 'failed', name, message: message(error) } });
        });
    },

    cancelLoad() {
      services.graph.cancel();
      parsing = undefined;
      set({ load: { state: 'idle' } });
    },
  };
}
