import type { ParseResult } from '../workers/protocol/graph';
import { WorkerTerminatedError } from '../workers/rpc';
import type { Context } from './store';

export interface FileInfo {
  name: string;
  size: number;
}

export type LoadState =
  | { state: 'idle' }
  | { state: 'parsing'; file: FileInfo; fraction: number }
  | { state: 'loaded'; file: FileInfo; result: ParseResult }
  | { state: 'failed'; file: FileInfo; message: string };

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
  cancelLoad: () => void;
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

    open(file) {
      const graph = services.graph;
      if (parsing) graph.cancel();
      parsing = file;
      get().stopLayout();
      const info = { name: file.name, size: file.size };
      set({ load: { state: 'parsing', file: info, fraction: 0 } });
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

    cancelLoad() {
      services.graph.cancel();
      parsing = undefined;
      set({ load: { state: 'idle' } });
    },
  };
}
