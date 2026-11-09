import { setBits } from './bits';
import { encodeFragment } from './share/codec';
import type { ShareState } from './share/state';
import type { Context } from './store';

/** Past this many characters a link may be cut off by chat apps and mail clients; the selection is dropped first. */
export const MAX_LINK_CHARS = 8000;

export interface SharingSlice {
  /** A link to the current view; `includeUrl` adds where the file was downloaded from. */
  shareLink: (includeUrl: boolean) => Promise<{ link: string; selectionDropped: boolean }>;
}

export function createSharingSlice(ctx: Context): SharingSlice {
  const { get, services } = ctx;

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
    async shareLink(includeUrl) {
      const state = await capture(includeUrl);
      const base = `${location.origin}${location.pathname}`;
      const link = `${base}${await encodeFragment(state)}`;
      if (link.length <= MAX_LINK_CHARS || !state.selection) return { link, selectionDropped: false };
      return { link: `${base}${await encodeFragment({ ...state, selection: undefined })}`, selectionDropped: true };
    },
  };
}
