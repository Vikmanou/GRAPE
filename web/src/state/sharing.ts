import { setBits } from './bits';
import { decodeFragment, encodeFragment, isShareFragment } from './share/codec';
import { type Fingerprint, sameFile } from './share/fingerprint';
import { restoreShared } from './share/restore';
import { parseShareState, type ShareState } from './share/state';
import type { Context } from './store';

/** Past this many characters a link may be cut off by chat apps and mail clients; the selection is dropped first. */
export const MAX_LINK_CHARS = 8000;

export interface SharingSlice {
  /** A link to the current view; `includeUrl` adds where the file was downloaded from. */
  shareLink: (includeUrl: boolean) => Promise<{ link: string; selectionDropped: boolean }>;
  /** A view from a link, waiting for the user to open its file. */
  pendingShare: ShareState | undefined;
  /** Reads a share link from the page's fragment, at start. */
  readShareLink: (hash: string) => Promise<void>;
  /** Restores the waiting view on a newly loaded file if it is the one the link was made from; otherwise lays it out as usual. */
  applyShare: (fingerprint: Fingerprint) => void;
  dismissShare: () => void;
  /** The current view and every point's position, as a session file. */
  saveSession: () => Promise<Blob>;
  /** Restores a session on its graph now if it is open, or once it is. */
  openSession: (file: File) => void;
}

/** Session files are told from graphs by name: `.grape.json`, gzipped or not. */
export function isSessionFile(name: string): boolean {
  return /\.grape\.json(\.gz)?$/i.test(name);
}

/** The fragment is applied once: reloading the page afterwards keeps the user's own view. */
function clearFragment(): void {
  if (typeof history !== 'undefined') history.replaceState(null, '', `${location.pathname}${location.search}`);
}

export function createSharingSlice(ctx: Context): SharingSlice {
  const { get, set, services } = ctx;
  /** A session's positions, waiting with `pendingShare` for its graph. */
  let pendingPositions: Float32Array<ArrayBuffer> | undefined;

  async function capture(includeUrl: boolean): Promise<ShareState> {
    const s = get();
    if (s.load.state !== 'loaded' || !s.fingerprint) throw new Error('open a graph first');
    const pathNames = s.paths.state === 'ready' ? s.paths.list.names : [];
    const selection = s.selection.count > 0 ? await services.graph.names(setBits(s.selection.bits)) : undefined;
    const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    return {
      file: s.fingerprint,
      url: includeUrl ? s.load.file.url : undefined,
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
      if (!isShareFragment(hash)) return;
      try {
        set({ pendingShare: parseShareState(await decodeFragment(hash)) });
      } catch (error) {
        clearFragment();
        get().toast('This share link cannot be opened', error instanceof Error ? error.message : String(error));
      }
    },

    applyShare(fingerprint) {
      const shared = get().pendingShare;
      if (!shared) {
        get().restartLayout();
        return;
      }
      const positions = pendingPositions;
      pendingPositions = undefined;
      set({ pendingShare: undefined });
      clearFragment();
      if (!sameFile(shared.file, fingerprint)) {
        get().toast(
          'This is not the file the link was made from',
          'It opens as it is. The link was made from a file of a different size, segment count or content.',
        );
        get().restartLayout();
        return;
      }
      restoreShared(ctx, shared, positions).catch((error: unknown) => {
        get().toast('The shared view could not be restored', error instanceof Error ? error.message : String(error));
      });
    },

    dismissShare() {
      pendingPositions = undefined;
      set({ pendingShare: undefined });
      clearFragment();
    },

    async saveSession() {
      const view = await capture(false);
      const { positions } = await ctx.bridge.ask({ type: 'read-positions' }, 'positions');
      return services.graph.writeSession(view, positions);
    },

    openSession(file) {
      services.graph
        .readSession(file)
        .then(({ view, positions }) => {
          const shared = parseShareState(view);
          pendingPositions = positions;
          set({ pendingShare: shared });
          const { fingerprint } = get();
          // The graph it was saved from may be open already.
          if (get().load.state === 'loaded' && fingerprint && sameFile(shared.file, fingerprint)) {
            get().applyShare(fingerprint);
          }
        })
        .catch((error: unknown) => {
          get().toast('This session cannot be opened', error instanceof Error ? error.message : String(error));
        });
    },

    async shareLink(includeUrl) {
      const state = await capture(includeUrl);
      const base = `${location.origin}${location.pathname}`;
      const link = `${base}${await encodeFragment(state)}`;
      if (link.length <= MAX_LINK_CHARS || !state.selection) return { link, selectionDropped: false };
      return { link: `${base}${await encodeFragment({ ...state, selection: undefined })}`, selectionDropped: true };
    },
  };
}
