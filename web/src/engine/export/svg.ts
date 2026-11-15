import type { SegmentData, Style } from '../core/backend';
import type { HitBands } from '../core/Bands';
import { cssColor, segmentColor, type Strand } from '../style/colors';
import { packRgba, palettes, type Rgba } from '../style/palette';
import { depthWidth, LINK_WIDTH, linkFade, outlineWidth, RIBBON_WIDTH, STRAND_SHIFT } from '../style/widths';
import { anchor, chain, type Chains, linkControls, type Point, point, spriteCenter, stretch } from './shapes';

/** The spec's cap (Features 11): past it the SVG is too heavy to open. */
export const SVG_MAX_SEGMENTS = 50_000;
/** Segments written between yields to the event loop. */
const SLICE = 2_000;
/** `DIMMED` in graph.wgsl: dimmed segments keep this much of their colour and fade into the background. */
const DIMMED = 0.35;

export interface SvgLabels {
  labels: { segment: number; text: string }[];
  /** Canvas pixels, as drawn. */
  fontPx: number;
  lineHeight: number;
}

export interface SvgScene extends Chains {
  segments: SegmentData;
  seed: number;
  style: Style;
  /** The camera's centre in layout units and the canvas it fills. */
  view: { x: number; y: number; zoom: number; width: number; height: number };
  selection: Uint32Array;
  hidden: { segments: Uint32Array; links: Uint32Array } | undefined;
  labels: SvgLabels;
  bands: HitBands | undefined;
}

export class TooManySegmentsError extends Error {
  constructor(readonly count: number) {
    super(
      `${count.toLocaleString('en')} segments are in view; an SVG holds at most ${SVG_MAX_SEGMENTS.toLocaleString('en')}. Zoom in or filter the graph first.`,
    );
  }
}

function bit(bits: Uint32Array | undefined, i: number): boolean {
  return bits !== undefined && (((bits[i >>> 5] ?? 0) >>> (i & 31)) & 1) === 1;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

function paint(color: Rgba | number): { color: string; opacity: number } {
  if (typeof color === 'number') return { color: cssColor(color), opacity: (color >>> 24) / 255 };
  return { color: cssColor(packRgba(color)), opacity: color[3] };
}

/** `color` (RGBA8, red low) mixed toward `into` by `1 - keep`, as the shaders fade a segment. */
function fadeInto(color: number, into: number, keep: number): number {
  const channel = (shift: number) =>
    Math.round(((into >>> shift) & 0xff) * (1 - keep) + ((color >>> shift) & 0xff) * keep) << shift;
  return (channel(0) | channel(8) | channel(16) | (color & 0xff000000)) >>> 0;
}

const yieldToEvents = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The view as an SVG in layout units, drawn as the shaders draw it; throws past `SVG_MAX_SEGMENTS`. */
export async function viewToSvg(scene: SvgScene): Promise<Blob> {
  const { view, style, geometry, positions, segments: data } = scene;
  const palette = palettes[style.theme];
  const { display } = style;
  const n = geometry.segmentStarts.length;
  const pixel = 1 / view.zoom;
  // Enough decimals that a pixel is never rounded away.
  const decimals = Math.min(6, Math.max(0, Math.ceil(Math.log10(view.zoom)) + 1));
  const f = (v: number) => Number(v.toFixed(decimals)).toString();
  const path = (points: readonly Point[]) => `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}`;

  const half = { x: view.width / 2 / view.zoom, y: view.height / 2 / view.zoom };
  const pad = RIBBON_WIDTH * 2 + STRAND_SHIFT + outlineWidth(view.zoom);
  const box = {
    minX: view.x - half.x - pad,
    minY: view.y - half.y - pad,
    maxX: view.x + half.x + pad,
    maxY: view.y + half.y + pad,
  };
  const inBox = ([x, y]: Point) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;

  const shown: number[] = [];
  for (let s = 0; s < n; s++) {
    if (bit(scene.hidden?.segments, s)) continue;
    const start = geometry.segmentStarts[s] ?? 0;
    const last = start + (geometry.segmentPieces[s] ?? 1);
    for (let i = start; i <= last; i++) {
      if (inBox(point(positions, i))) {
        shown.push(s);
        break;
      }
    }
  }
  if (shown.length > SVG_MAX_SEGMENTS) throw new TooManySegmentsError(shown.length);

  const strands: [Strand, number][] = display.double
    ? [
        ['forward', 1],
        ['reverse', -1],
      ]
    : [['single', 0]];
  const colors = { mode: display.color, range: display.range, seed: scene.seed, unknown: packRgba(palette.unknown) };
  const halfWidth = (s: number) =>
    Math.max((display.widthByDepth ? depthWidth(data.depth[s] ?? NaN, data.meanDepth) : RIBBON_WIDTH) / 2, pixel / 2);
  const anySelected = scene.selection.some((w) => w !== 0);
  const dim = display.dimUnselected && anySelected;

  const out: string[] = [];
  const bg = paint(palette.background);
  const background = packRgba(palette.background);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(view.width)}" height="${String(view.height)}" viewBox="${f(view.x - half.x)} ${f(view.y - half.y)} ${f(half.x * 2)} ${f(half.y * 2)}">\n`,
    `<rect x="${f(view.x - half.x)}" y="${f(view.y - half.y)}" width="${f(half.x * 2)}" height="${f(half.y * 2)}" fill="${bg.color}"/>\n`,
  );

  const linkAlpha = linkFade(view.zoom, display.linkFullPx);
  if (linkAlpha > 0) {
    const link = paint(palette.link);
    out.push(
      `<g fill="none" stroke="${link.color}" stroke-opacity="${f(link.opacity * linkAlpha)}" stroke-width="${f(Math.max(LINK_WIDTH, 1.5 * pixel))}">\n`,
    );
    const links = geometry.links.length / 4;
    for (let l = 0; l < links; l++) {
      if (bit(scene.hidden?.links, l)) continue;
      for (const [, strand] of strands) {
        const c = linkControls(scene, l, strand, STRAND_SHIFT, RIBBON_WIDTH / 2);
        const [p0, c1, c2, p3] = c as [Point, Point, Point, Point];
        if (!inBox(p0) && !inBox(p3)) continue;
        out.push(`<path d="M${f(p0[0])} ${f(p0[1])}C${[c1, c2, p3].map(([x, y]) => `${f(x)} ${f(y)}`).join(' ')}"/>\n`);
      }
      if (l % (SLICE * 4) === 0) await yieldToEvents();
    }
    out.push('</g>\n');
  }

  out.push('<g fill="none" stroke-linecap="round" stroke-linejoin="round">\n');
  for (const [i, s] of shown.entries()) {
    const faded = dim && !bit(scene.selection, s);
    const dot = spriteCenter(scene, s, display.spritePx * pixel);
    for (const [name, strand] of strands) {
      const packed = segmentColor(colors, data, s, name);
      const color = cssColor(faded ? fadeInto(packed, background, DIMMED) : packed);
      if (dot) {
        out.push(`<circle cx="${f(dot[0])}" cy="${f(dot[1])}" r="${f(halfWidth(s))}" fill="${color}"/>\n`);
        continue;
      }
      const d = path(chain(scene, s, strand, STRAND_SHIFT));
      out.push(`<path d="${d}" stroke="${color}" stroke-width="${f(halfWidth(s) * 2)}"/>\n`);
    }
    if (i % SLICE === SLICE - 1) await yieldToEvents();
  }
  out.push('</g>\n');

  // Selected segments again on top, outlined, as the highlight passes draw them.
  if (anySelected) {
    const outline = paint(palette.selection);
    const inner = paint(palette.selectionInner);
    const width = outlineWidth(view.zoom);
    out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">\n`);
    for (const s of shown) {
      if (!bit(scene.selection, s)) continue;
      for (const [name, strand] of strands) {
        const d = path(chain(scene, s, strand, STRAND_SHIFT));
        const w = halfWidth(s) * 2;
        const color = cssColor(segmentColor(colors, data, s, name));
        out.push(
          `<path d="${d}" stroke="${outline.color}" stroke-opacity="${f(outline.opacity)}" stroke-width="${f(w + width)}"/>\n`,
          `<path d="${d}" stroke="${inner.color}" stroke-opacity="${f(inner.opacity)}" stroke-width="${f(w)}"/>\n`,
          `<path d="${d}" stroke="${color}" stroke-width="${f(Math.max(w - width, pixel))}"/>\n`,
        );
      }
    }
    out.push('</g>\n');
  }

  const bands = scene.bands;
  if (bands && bands.segments.length > 0) {
    const visible = new Set(shown);
    out.push('<g fill="none" stroke-linecap="butt" stroke-linejoin="round">\n');
    for (let i = 0; i < bands.segments.length; i++) {
      const s = bands.segments[i] ?? 0;
      if (!visible.has(s)) continue;
      const strand = display.double ? ((bands.reverse[i] ?? 0) === 1 ? -1 : 1) : 0;
      const pieces = geometry.segmentPieces[s] ?? 1;
      const points = stretch(
        chain(scene, s, strand, STRAND_SHIFT),
        (bands.starts[i] ?? 0) * pieces,
        (bands.ends[i] ?? 0) * pieces,
      );
      const band = paint(bands.colors[i] ?? 0);
      out.push(
        `<path d="${path(points)}" stroke="${band.color}" stroke-opacity="${f(band.opacity)}" stroke-width="${f(halfWidth(s) * 2)}"/>\n`,
      );
    }
    out.push('</g>\n');
  }

  const { labels, fontPx, lineHeight } = scene.labels;
  if (labels.length > 0) {
    const ink = paint(palette.label);
    const size = fontPx / view.zoom;
    const line = lineHeight / view.zoom;
    out.push(
      `<g font-family="'JetBrains Mono', monospace" font-size="${f(size)}" text-anchor="middle" dominant-baseline="central" fill="${ink.color}" stroke="${bg.color}" stroke-width="${f(3 * pixel)}" paint-order="stroke">\n`,
    );
    for (const { segment, text } of labels) {
      if (bit(scene.hidden?.segments, segment)) continue;
      const [x, y] = anchor(scene, segment);
      const lines = text.split('\n');
      const top = y - (lines.length * line) / 2 + line / 2;
      const spans = lines.map((t, k) => `<tspan x="${f(x)}" y="${f(top + k * line)}">${escape(t)}</tspan>`).join('');
      out.push(`<text>${spans}</text>\n`);
    }
    out.push('</g>\n');
  }
  out.push('</svg>\n');
  return new Blob(out, { type: 'image/svg+xml' });
}
