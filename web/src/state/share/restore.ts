import type { AppState } from '../store';
import type { Context } from '../store';
import type { ShareState } from './state';

/** Resolves once `ready` holds, or with false once `stale` does: another file was opened meanwhile. */
function until(ctx: Context, ready: (s: AppState) => boolean, stale: (s: AppState) => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const check = (s: AppState) => {
      if (stale(s)) return false;
      return ready(s) ? true : undefined;
    };
    const now = check(ctx.get());
    if (now !== undefined) {
      resolve(now);
      return;
    }
    const off = ctx.subscribe((s) => {
      const result = check(s);
      if (result === undefined) return;
      off();
      resolve(result);
    });
  });
}

/**
 * Brings back a shared view on the file it was made from: the layout's seed
 * and settings first, so the same layout grows, or a session's positions,
 * then merging, filters, paths and colours, and the camera and selection
 * once the layout settles.
 */
export async function restoreShared(
  ctx: Context,
  shared: ShareState,
  positions?: Float32Array<ArrayBuffer>,
): Promise<void> {
  const { get, set, services } = ctx;
  const loaded = get().load;
  const stale = (s: AppState) => s.load !== loaded;

  set({ layoutOptions: { seed: shared.layout.seed, quality: shared.layout.quality } });
  get().setLabels(shared.labels);
  if (positions) get().queuePositions(positions);
  if (shared.merged) get().setMerged(true);
  else get().restartLayout();
  if (!(await until(ctx, (s) => !s.merging && (!shared.merged || s.merged !== undefined), stale))) return;

  get().setFilters(shared.filters);
  if (!(await until(ctx, (s) => s.paths.state !== 'loading' && s.paths.state !== 'none', stale))) return;
  const { paths } = get();
  const names = paths.state === 'ready' ? paths.list.names : [];
  for (const name of shared.paths) {
    const index = names.indexOf(name);
    if (index >= 0) get().toggleHighlight(index);
  }
  // After the paths, which switch to their colour mode.
  get().setDisplayOptions(shared.display);

  if (!(await until(ctx, (s) => s.layoutStatus.state === 'done' || s.layoutStatus.state === 'failed', stale))) return;
  const sameLayout = positions !== undefined || (shared.layout.kind === 'gpu') === get().gpuLayout;
  if (shared.camera && sameLayout) {
    const { x, y, zoom } = shared.camera;
    ctx.bridge.send({ type: 'set-camera', x, y, zoom: zoom * devicePixelRatio });
  } else if (shared.camera) {
    get().toast(
      'The view was shared from another renderer',
      'WebGPU and WebGL2 lay graphs out differently, so the camera starts fitted to the graph. A session file keeps positions exact on either.',
    );
  }
  if (shared.selection && shared.selection.length > 0) {
    const { segments, missing } = await services.graph.find({ kind: 'names', names: shared.selection });
    if (stale(get())) return;
    get().select(segments, 'replace');
    if (missing.length > 0) {
      get().toast(`${String(missing.length)} selected segments were not found`, missing.slice(0, 20).join(', '));
    }
  }
}
