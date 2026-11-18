import type { FastaAttached, ParseResult } from '../workers/protocol/graph';
import { WorkerTerminatedError } from '../workers/shared/rpc';
import { EXAMPLES, fetchExample } from './examples';
import { fetchFile, fileNameOf } from './fetchFile';
import { type Fingerprint, headHash } from './share/fingerprint';
/** BandageNG's layout files are told from graphs by name. */
const isLayoutFile = (name: string) => /\.layout$/i.test(name);
import type { MergeSlice } from './merge';
import type { Context } from './store';

/** The v1 ceiling (spec, Overview); larger graphs load with a warning. */
const MAX_SEGMENTS = 1_000_000;
const MAX_LINKS = 1_500_000;

export interface FileInfo {
  name: string;
  size: number;
  /** Where the file was downloaded from, when it was opened from a URL. */
  url?: string | undefined;
}

export type LoadState =
  | { state: 'idle' }
  /** `fraction` is undefined when the server gives no length. */
  | { state: 'fetching'; file: FileInfo; fraction: number | undefined }
  /** A share link's graph being unpacked (sharing.ts). */
  | { state: 'unpacking'; file: FileInfo }
  | { state: 'parsing'; file: FileInfo; fraction: number }
  /** `source` is kept to pack into a share link. */
  | { state: 'loaded'; file: FileInfo; result: ParseResult; source: File }
  | { state: 'failed'; file: FileInfo; message: string };

export type SequenceFileState =
  | { state: 'none' }
  | { state: 'reading'; name: string; fraction: number }
  | { state: 'added'; name: string; attached: FastaAttached; source: File }
  | { state: 'failed'; name: string; message: string };

export type CoreStatus =
  | { state: 'loading' }
  | { state: 'ready'; version: string; roundTripMs: number }
  | { state: 'error'; message: string };

export interface FileSlice {
  core: CoreStatus;
  load: LoadState;
  startCore: () => void;
  /** A newer file replaces one still parsing; `url` is where it was downloaded from. */
  open: (file: File, url?: string) => void;
  /** Opens one of the bundled examples, by id. */
  openExample: (id: string) => void;
  /** Downloads a graph the user named by URL, straight from the browser, and opens it. */
  openUrl: (url: string) => void;
  cancelLoad: () => void;
  /** The loaded file's fingerprint for share links, once its start is hashed. */
  fingerprint: Fingerprint | undefined;
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
  let downloading: AbortController | undefined;

  return {
    core: { state: 'loading' },
    load: { state: 'idle' },
    sequenceFile: { state: 'none' },
    fingerprint: undefined,

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

    openUrl(text) {
      // A share link pasted here opens without the address bar's length limit.
      // Found by text: Firefox's URL parser refuses links over 1 MiB.
      const fragment = text.trim().search(/#[gv]=/);
      if (fragment >= 0) {
        void get().readShareLink(text.trim().slice(fragment));
        return;
      }
      let url: URL;
      try {
        url = new URL(text.trim());
      } catch {
        get().toast('That is not a URL', `"${text}" is not a full address such as https://example.org/graph.gfa.gz`);
        return;
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        get().toast('Only web addresses can be opened', `${url.protocol} URLs are not supported; use https:`);
        return;
      }
      if (parsing) services.graph.cancel();
      parsing = undefined;
      downloading?.abort();
      const controller = new AbortController();
      downloading = controller;
      const info = { name: fileNameOf(url), size: 0, url: url.href };
      set({ load: { state: 'fetching', file: info, fraction: 0 } });
      fetchFile(url, controller.signal, (fraction) => {
        if (downloading === controller) set({ load: { state: 'fetching', file: info, fraction } });
      }).then(
        (file) => {
          if (downloading !== controller) return;
          downloading = undefined;
          get().open(file, url.href);
        },
        (error: unknown) => {
          if (downloading !== controller) return;
          downloading = undefined;
          set({ load: { state: 'failed', file: info, message: message(error) } });
        },
      );
    },

    open(file, url) {
      if (isLayoutFile(file.name)) {
        get().openLayout(file);
        return;
      }
      downloading?.abort();
      downloading = undefined;
      const graph = services.graph;
      if (parsing) graph.cancel();
      parsing = file;
      get().stopLayout();
      get().clearSearch();
      const info = { name: file.name, size: file.size, url };
      const hash = headHash(file);
      set({
        fingerprint: undefined,
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
            set({ load: { state: 'loaded', file: info, result, source: file }, warningsOpen: false });
            const loaded = get().load;
            const shared = get().pendingShare !== undefined;
            hash.then(
              (sha256) => {
                if (get().load !== loaded) return;
                const fingerprint = { size: file.size, segments: result.stats.segments, sha256 };
                set({ fingerprint });
                if (shared) get().applyShare();
              },
              (error: unknown) => {
                get().toast('This file cannot be shared by link', message(error));
                if (shared && get().load === loaded) get().restartLayout();
              },
            );
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
            // A shared view waits for the file's hash, to lay it out from the link's seed.
            if (!shared) get().restartLayout();
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
            sequenceFile: { state: 'added', name, attached, source: file },
          });
          get().clearSearch();
          await services.sequence.load(sequences);
          get().resetColorRange();
          // New lengths change the layout; new GC only colours. A shared view lays itself out next.
          if (attached.resized > 0 || merged) {
            if (!get().pendingShare) get().restartLayout();
          } else ctx.bridge.send({ type: 'set-gc', gc: result.attributes.gc });
        })
        .catch((error: unknown) => {
          if (error instanceof WorkerTerminatedError) return;
          set({ sequenceFile: { state: 'failed', name, message: message(error) } });
        });
    },

    cancelLoad() {
      if (get().load.state === 'unpacking') services.pack.cancel();
      downloading?.abort();
      downloading = undefined;
      services.graph.cancel();
      parsing = undefined;
      set({ load: { state: 'idle' } });
    },
  };
}
