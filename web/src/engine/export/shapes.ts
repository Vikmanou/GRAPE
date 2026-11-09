// The shapes the graph shaders draw, computed on the CPU for the SVG export:
// the same chains, strand shifts and link curves as graph.wgsl.

import type { Geometry } from '../../workers/protocol/layout';

export type Point = readonly [number, number];

export interface Chains {
  positions: Float32Array;
  geometry: Pick<Geometry, 'segmentStarts' | 'segmentPieces' | 'links'>;
}

export function point(positions: Float32Array, i: number): Point {
  return [positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0];
}

/** `left_of` in graph.wgsl: the unit vector to the left of `d`, as y points down. */
function leftOf([dx, dy]: Point): Point {
  const l = Math.hypot(dx, dy);
  return l > 1e-6 ? [dy / l, -dx / l] : [0, 0];
}

function unitOr([dx, dy]: Point, fallback: Point): Point {
  const l = Math.hypot(dx, dy);
  return l > 1e-6 ? [dx / l, dy / l] : fallback;
}

/** A segment's chain, moved to the side of `strand` (1 forward, -1 reverse, 0 none) as `strand_point` does. */
export function chain({ positions, geometry }: Chains, segment: number, strand: number, shift: number): Point[] {
  const start = geometry.segmentStarts[segment] ?? 0;
  const last = start + (geometry.segmentPieces[segment] ?? 1);
  const out: Point[] = [];
  for (let i = start; i <= last; i++) {
    const p = point(positions, i);
    if (strand === 0) {
      out.push(p);
      continue;
    }
    const before = point(positions, i === start ? i : i - 1);
    const after = point(positions, i === last ? i : i + 1);
    const [lx, ly] = leftOf([after[0] - before[0], after[1] - before[1]]);
    out.push([p[0] + lx * strand * shift, p[1] + ly * strand * shift]);
  }
  return out;
}

/** The points of `points` from `from` to `to`, counted in pieces from its start, as bands are placed. */
export function stretch(points: Point[], from: number, to: number): Point[] {
  const at = (u: number): Point => {
    const p = Math.min(Math.max(Math.floor(u), 0), points.length - 2);
    const t = u - p;
    const [a, b] = [points[p] ?? [0, 0], points[p + 1] ?? [0, 0]];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const out = [at(from)];
  for (let i = Math.floor(from) + 1; i < to; i++) out.push(points[i] ?? [0, 0]);
  out.push(at(to));
  return out;
}

/** `controls` in graph.wgsl: a link's Bézier, leaving each end along its segment, ends that meet opened into a loop. */
export function linkControls(c: Chains, link: number, strand: number, shift: number, ribbonHalf: number): Point[] {
  const l = c.geometry.links;
  const [endA, innerA, endB, innerB] = [
    l[link * 4] ?? 0,
    l[link * 4 + 1] ?? 0,
    l[link * 4 + 2] ?? 0,
    l[link * 4 + 3] ?? 0,
  ];
  const [a, ia, b, ib] = [endA, innerA, endB, innerB].map((i) => point(c.positions, i)) as [Point, Point, Point, Point];
  const outA = unitOr([a[0] - ia[0], a[1] - ia[1]], [1, 0]);
  const outB = unitOr([b[0] - ib[0], b[1] - ib[1]], [-1, 0]);
  const s = strand * shift;
  const [la, lb] = [leftOf(outA), leftOf(outB)];
  const p0: Point = [a[0] + la[0] * s, a[1] + la[1] * s];
  const p3: Point = [b[0] - lb[0] * s, b[1] - lb[1] * s];
  const gap = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const reach = Math.max(gap * 0.4, ribbonHalf * 6);
  if (gap < ribbonHalf * 4) {
    const side: Point = [-outA[1], outA[0]];
    return [
      p0,
      [p0[0] + (outA[0] + side[0]) * reach, p0[1] + (outA[1] + side[1]) * reach],
      [p3[0] + (outB[0] - side[0]) * reach, p3[1] + (outB[1] - side[1]) * reach],
      p3,
    ];
  }
  return [
    p0,
    [p0[0] + outA[0] * reach, p0[1] + outA[1] * reach],
    [p3[0] + outB[0] * reach, p3[1] + outB[1] * reach],
    p3,
  ];
}

/** `sprite_center` in graph.wgsl: where a segment shorter than `spriteWorld` draws as one dot, or undefined. */
export function spriteCenter(c: Chains, segment: number, spriteWorld: number): Point | undefined {
  const start = c.geometry.segmentStarts[segment] ?? 0;
  const pieces = c.geometry.segmentPieces[segment] ?? 1;
  const mid = start + Math.floor(pieces / 2);
  const [a, m, b] = [point(c.positions, start), point(c.positions, mid), point(c.positions, start + pieces)];
  const extent = Math.max(Math.hypot(m[0] - a[0], m[1] - a[1]), Math.hypot(b[0] - m[0], b[1] - m[1]));
  return extent < spriteWorld ? anchor(c, segment) : undefined;
}

/** `labels.wgsl`'s `anchor`: the middle of a segment's chain. */
export function anchor({ positions, geometry }: Chains, segment: number): Point {
  const start = geometry.segmentStarts[segment] ?? 0;
  const pieces = geometry.segmentPieces[segment] ?? 1;
  const mid = start + Math.floor(pieces / 2);
  const [a, b] = [point(positions, mid), point(positions, mid + (pieces % 2))];
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
