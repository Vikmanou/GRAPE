import { COLOR_MODES, DEFAULT_DISPLAY, type DisplayOptions } from '../../engine/style/display';
import type { Quality } from '../../workers/protocol/layout';
import { DEFAULT_LABELS, type LabelSettings } from '../labels';
import { sameShape } from '../shape';
import type { Fingerprint } from './fingerprint';
import { ShareLinkError } from './codec';

const QUALITIES: Quality[] = ['fast', 'balanced', 'best'];
/** Names kept from a link, so a crafted one cannot ask for unbounded work. */
const MAX_NAMES = 100_000;

/** The view a share link carries (spec, Features 12). Sequences never travel in it. */
export interface ShareState {
  file: Fingerprint;
  /**
   * `gpu` positions come from the WebGPU layout, `cpu` from the layout
   * worker's; the same seed gives the same picture only on the same kind.
   */
  layout: { seed: number; quality: Quality; kind: 'gpu' | 'cpu' };
  merged: boolean;
  /** Centre in layout units and CSS pixels per unit, so it holds across screens. */
  camera?: { x: number; y: number; zoom: number } | undefined;
  display: DisplayOptions;
  labels: LabelSettings;
  filters: { minComponentLength: number; depth?: { min: number; max: number } | undefined };
  /** Segment names, of the merged graph when `merged`. */
  selection?: string[] | undefined;
  /** Names of the highlighted paths, in highlighting order. */
  paths: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, MAX_NAMES) : [];
}

/** Checks what a link decoded to, keeping defaults where a field is missing or of the wrong kind. */
export function parseShareState(value: unknown): ShareState {
  if (!isRecord(value) || !isRecord(value.file) || !isRecord(value.layout)) {
    throw new ShareLinkError('This link does not describe a GRAPE view.');
  }
  const { file, layout } = value;
  if (!finite(file.size) || !finite(file.segments) || typeof file.sha256 !== 'string') {
    throw new ShareLinkError('This link does not say which file it shows.');
  }
  const display = sameShape(DEFAULT_DISPLAY, value.display);
  display.color = COLOR_MODES.find((m) => m === display.color) ?? DEFAULT_DISPLAY.color;
  const scale: unknown = display.range.scale;
  if (scale !== 'linear' && scale !== 'log') display.range.scale = 'linear';
  const camera = isRecord(value.camera) ? value.camera : undefined;
  const filters = isRecord(value.filters) ? value.filters : {};
  const depth = isRecord(filters.depth) ? filters.depth : undefined;
  const seed = finite(layout.seed) ? layout.seed >>> 0 : 1;
  return {
    file: { size: file.size, segments: file.segments, sha256: file.sha256 },
    layout: {
      seed,
      quality: QUALITIES.find((q) => q === layout.quality) ?? 'balanced',
      kind: layout.kind === 'cpu' ? 'cpu' : 'gpu',
    },
    merged: value.merged === true,
    camera:
      camera && finite(camera.x) && finite(camera.y) && finite(camera.zoom) && camera.zoom > 0
        ? { x: camera.x, y: camera.y, zoom: camera.zoom }
        : undefined,
    display,
    labels: sameShape(DEFAULT_LABELS, value.labels),
    filters: {
      minComponentLength: finite(filters.minComponentLength) ? Math.max(0, filters.minComponentLength) : 0,
      depth: depth && finite(depth.min) && finite(depth.max) ? { min: depth.min, max: depth.max } : undefined,
    },
    selection: Array.isArray(value.selection) ? names(value.selection) : undefined,
    paths: names(value.paths),
  };
}
