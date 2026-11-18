import { setBits } from './util/bits';
import type { LinkFile } from '../workers/protocol/pack';
import { WorkerTerminatedError } from '../workers/shared/rpc';
import { isPackedFragment, packedFragment, packedPayload } from './share/codec';
import { restoreShared, until } from './share/restore';
import { parseShareState, type ShareState } from './share/state';
import type { Context } from './store';

/** Chrome refuses URLs past 2 MiB (chromium/src/url/url_constants.h, kMaxURLChars). */
export const MAX_PACKED_LINK_CHARS = 2 * 1024 * 1024;
/** Firefox 157 refuses URLs past about 1 MiB, measured: 1,048,570 characters open, 1,048,575 do not. */
export const FIREFOX_LINK_CHARS = 1_048_570;

export type PackedLink = { state: 'ready'; link: string } | { state: 'too-big' } | { state: 'cancelled' };

export interface SharingSlice {
  /** A link carrying the whole graph, unless that would pass `MAX_PACKED_LINK_CHARS`. */
  packLink: () => Promise<PackedLink>;
  cancelPack: () => void;
  /** The view a link carried, applied once its graph has loaded. */
  pendingShare: ShareState | undefined;
  /** Reads a share link from the page's fragment. */
  readShareLink: (hash: string) => Promise<void>;
  /** Restores the waiting view on the graph that came with it; otherwise lays the graph out as usual. */
  applyShare: () => void;
}

/** The fragment is applied once: reloading the page afterwards keeps the user's own view. */
function clearFragment(): void {
  if (typeof history !== 'undefined') history.replaceState(null, '', `${location.pathname}${location.search}`);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createSharingSlice(ctx: Context): SharingSlice {
  const { get, set, services } = ctx;
  /** The FASTA a link carried, attached before its view is restored. */
  let pendingFasta: File | undefined;

  async function openPacked(hash: string): Promise<void> {
    const info = { name: 'graph from the link', size: 0 };
    let payload: string;
    try {
      payload = packedPayload(hash);
    } catch (error) {
      clearFragment();
      get().toast('This share link cannot be opened', error instanceof Error ? error.message : String(error));
      return;
    }
    get().stopLayout();
    set({ load: { state: 'unpacking', file: info } });
    const unpacking = get().load;
    try {
      const { view, files } = await services.pack.unpack(payload);
      if (get().load !== unpacking) return;
      const graph = files.find((f) => f.kind === 'graph');
      if (!graph) throw new Error('This link is damaged: it holds no graph.');
      pendingFasta = files.find((f) => f.kind === 'fasta')?.file;
      set({ pendingShare: parseShareState(view) });
      clearFragment();
      get().open(graph.file);
    } catch (error) {
      if (error instanceof WorkerTerminatedError || get().load !== unpacking) return;
      clearFragment();
      set({ load: { state: 'failed', file: info, message: error instanceof Error ? error.message : String(error) } });
    }
  }

  async function restore(shared: ShareState, fasta: File | undefined) {
    if (fasta) {
      const { load } = get();
      const source = load.state === 'loaded' ? load.source : undefined;
      get().addSequences(fasta);
      const attached = await until(
        ctx,
        (s) => s.sequenceFile.state === 'added' || s.sequenceFile.state === 'failed',
        (s) => s.load.state !== 'loaded' || s.load.source !== source,
      );
      if (!attached) return;
    }
    set({ pendingShare: undefined });
    await restoreShared(ctx, shared);
  }

  async function capture(): Promise<ShareState> {
    const s = get();
    if (s.load.state !== 'loaded' || !s.fingerprint) throw new Error('open a graph first');
    const pathNames = s.paths.state === 'ready' ? s.paths.list.names : [];
    const selection = s.selection.count > 0 ? await services.graph.names(setBits(s.selection.bits)) : undefined;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    return {
      file: s.fingerprint,
      layout: { ...s.layoutOptions, kind: s.gpuLayout ? 'gpu' : 'cpu' },
      merged: s.merged !== undefined,
      camera: s.camera && { x: s.camera.x, y: s.camera.y, zoom: s.camera.zoom / dpr },
      display: s.displayOptions,
      labels: s.labels,
      filters: { minComponentLength: s.filters.minComponentLength, depth: s.filters.depth },
      selection,
      paths: s.highlightedPaths.map((p) => pathNames[p] ?? '').filter((name) => name !== ''),
    };
  }

  return {
    pendingShare: undefined,

    async readShareLink(hash) {
      if (isPackedFragment(hash)) {
        await openPacked(hash);
      } else if (hash.startsWith('#v=')) {
        clearFragment();
        get().toast(
          'This link holds no graph',
          'It was made by an older GRAPE that shared only the view. Ask for a new link, which carries the graph.',
        );
      }
    },

    applyShare() {
      const shared = get().pendingShare;
      if (!shared) {
        get().restartLayout();
        return;
      }
      const fasta = pendingFasta;
      pendingFasta = undefined;
      restore(shared, fasta).catch((error: unknown) => {
        get().toast('The shared view could not be restored', message(error));
      });
    },

    async packLink() {
      const s = get();
      if (s.load.state !== 'loaded') throw new Error('open a graph first');
      const view = await capture();
      const files: LinkFile[] = [{ kind: 'graph', file: s.load.source }];
      if (s.sequenceFile.state === 'added') files.push({ kind: 'fasta', file: s.sequenceFile.source });
      const base = `${location.origin}${location.pathname}`;
      const room = MAX_PACKED_LINK_CHARS - base.length - packedFragment('').length;
      try {
        const payload = await services.pack.pack(view, files, room);
        return payload === undefined
          ? { state: 'too-big' }
          : { state: 'ready', link: `${base}${packedFragment(payload)}` };
      } catch (error) {
        if (error instanceof WorkerTerminatedError) return { state: 'cancelled' };
        throw error;
      }
    },

    cancelPack() {
      services.pack.cancel();
    },
  };
}
