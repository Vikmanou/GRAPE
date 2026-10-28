import type { Geometry } from '../../workers/protocol/layout';
import type { SegmentData, Style, View } from '../core/backend';
import { mix, NO_TAG_COLOR, UNIFORM_COLOR, UNIFORM_REVERSE_COLOR } from './colors';
import { COLOR_MODES } from './display';
import { packRgba, palettes, type Rgba } from './palette';
import { ramp, RAMP_SIZE } from './ramps';
import { LINK_WIDTH, linkFade, outlineWidth, RIBBON_WIDTH, STRAND_SHIFT } from './widths';

// The blocks below are laid out for both shader languages: WGSL's uniform
// rules and std140 give these fields the same offsets.

/** What a backend draws with: the camera and the colours and widths of this frame. */
export interface DrawnView extends View {
  ribbonHalf: number;
  linkHalf: number;
  linkAlpha: number;
  linkColor: Rgba;
  outline: Rgba;
  hoverOutline: Rgba;
  /** Width of the selection outline in world units. */
  outlineWidth: number;
  hover: number | undefined;
}

export function drawnView(view: View, style: Style, hover: number | undefined): DrawnView {
  const palette = palettes[style.theme];
  return {
    ...view,
    ribbonHalf: RIBBON_WIDTH / 2,
    linkHalf: LINK_WIDTH / 2,
    linkAlpha: linkFade(view.zoom, style.display.linkFullPx),
    linkColor: palette.link,
    outline: palette.selection,
    hoverOutline: palette.hover,
    outlineWidth: outlineWidth(view.zoom),
    hover,
  };
}

/** `View` in graph.wgsl and the graph shaders: 23 words, padded to 24. */
export const VIEW_BYTES = 96;
const NO_SEGMENT = 0xffffffff;

/** `grow` widens ribbons for the outline pass; `strand` is 0 in single mode, 1 or -1 per strand in double mode. */
export function packView(out: ArrayBuffer, view: DrawnView, grow: number, strand: number): void {
  const f = new Float32Array(out);
  f.set([
    view.centerX,
    view.centerY,
    (view.zoom * 2) / view.width,
    (-view.zoom * 2) / view.height,
    1 / view.zoom,
    view.ribbonHalf,
    view.linkHalf,
    view.linkAlpha,
    ...view.linkColor,
    ...view.outline,
    ...view.hoverOutline,
    grow,
  ]);
  new Uint32Array(out)[21] = view.hover ?? NO_SEGMENT;
  f[22] = strand;
}

export interface StyledGraph {
  segments: number;
  seed: number;
  meanDepth: number;
}

/** `Style` in the graph shaders: 16 words, then the ramp. */
const HEADER_WORDS = 16;
export const STYLE_BYTES = (HEADER_WORDS + RAMP_SIZE) * 4;

/** `dim` when unselected segments should fade now. */
export function packStyle(out: ArrayBuffer, style: Style, graph: StyledGraph, dim: boolean): void {
  const { display } = style;
  const log = display.range.scale === 'log';
  const along = (v: number) => (log ? Math.log(Math.max(v, 1e-30)) : v);
  const u = new Uint32Array(out);
  const f = new Float32Array(out);
  u[0] = COLOR_MODES.indexOf(display.color);
  u[1] = log ? 1 : 0;
  f[2] = along(display.range.min);
  f[3] = along(display.range.max);
  u[4] = mix(graph.seed);
  u[5] = graph.segments;
  u[6] = display.widthByDepth ? 1 : 0;
  f[7] = graph.meanDepth;
  u[8] = UNIFORM_COLOR;
  u[9] = packRgba(palettes[style.theme].unknown);
  u[10] = NO_TAG_COLOR;
  u[11] = dim ? 1 : 0;
  f[12] = display.spritePx;
  f[13] = STRAND_SHIFT;
  u[14] = UNIFORM_REVERSE_COLOR;
  u.set(ramp, HEADER_WORDS);
}

/** The fields of the shaders' segment table, each a run of one u32 per segment. */
export const FIELDS = ['depth', 'gc', 'length', 'component', 'tag', 'tag2', 'start', 'pieces', 'path'] as const;

export type SegmentField = (typeof FIELDS)[number];

function dense(segments: number, tags: SegmentData['tagColors']): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(segments);
  tags.segments.forEach((segment, i) => {
    out[segment] = tags.colors[i] ?? 0;
  });
  return out;
}

/** Each field's run, in the order of `FIELDS`. */
export function segmentRuns(geometry: Geometry, data: SegmentData): ArrayBufferView[] {
  const n = geometry.segments;
  const runs: Record<SegmentField, ArrayBufferView> = {
    depth: data.depth,
    gc: data.gc,
    length: data.lengths,
    component: data.components,
    tag: dense(n, data.tagColors),
    tag2: dense(n, data.tagColors2),
    start: geometry.segmentStarts,
    pieces: Uint32Array.from(geometry.segmentPieces),
    path: data.pathColors ?? new Uint32Array(n),
  };
  return FIELDS.map((field) => runs[field]);
}
