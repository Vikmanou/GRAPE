import type { CellLists, PositionGrid } from '../../workers/protocol/layout';
import type { Bounds } from '../core/camera';

/**
 * Items whose grid cells overlap `area`, each once and in index order, kept
 * when `keep` says so. `marks` is a scratch bitset over the items, left
 * cleared; `out` receives the items. Returns how many there are.
 */
export function collect(
  grid: PositionGrid,
  lists: CellLists,
  area: Bounds,
  marks: Uint32Array,
  out: Uint32Array,
  keep: (item: number) => boolean,
): number {
  let lo = marks.length;
  let hi = -1;
  const mark = (item: number) => {
    const word = item >>> 5;
    marks[word] = (marks[word] ?? 0) | (1 << (item & 31));
    if (word < lo) lo = word;
    if (word > hi) hi = word;
  };
  for (const item of lists.wide) mark(item);
  const { minX, minY, cell, columns, rows } = grid;
  const inside =
    area.maxX >= minX && area.maxY >= minY && area.minX <= minX + columns * cell && area.minY <= minY + rows * cell;
  if (inside) {
    const col = (x: number) => Math.min(columns - 1, Math.max(0, Math.floor((x - minX) / cell)));
    const row = (y: number) => Math.min(rows - 1, Math.max(0, Math.floor((y - minY) / cell)));
    const [c0, c1, r0, r1] = [col(area.minX), col(area.maxX), row(area.minY), row(area.maxY)];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * columns + c;
        const end = lists.starts[k + 1] ?? 0;
        for (let i = lists.starts[k] ?? 0; i < end; i++) mark(lists.items[i] ?? 0);
      }
    }
  }
  let count = 0;
  for (let word = lo; word <= hi; word++) {
    let bits = marks[word] ?? 0;
    marks[word] = 0;
    while (bits !== 0) {
      const low = bits & -bits;
      const item = word * 32 + 31 - Math.clz32(low);
      bits ^= low;
      if (keep(item)) out[count++] = item;
    }
  }
  return count;
}

/** Whether `area` holds the whole grid, and so every item. */
export function coversGrid(grid: PositionGrid, area: Bounds): boolean {
  return (
    area.minX <= grid.minX &&
    area.minY <= grid.minY &&
    area.maxX >= grid.minX + grid.columns * grid.cell &&
    area.maxY >= grid.minY + grid.rows * grid.cell
  );
}

/** The same grid with its frame moved by `-dx, -dy`, for positions relative to an origin. */
export function shiftGrid(grid: PositionGrid, dx: number, dy: number): PositionGrid {
  return { ...grid, minX: grid.minX - dx, minY: grid.minY - dy };
}

function overlaps(x0: number, y0: number, x1: number, y1: number, area: Bounds): boolean {
  return x1 >= area.minX && x0 <= area.maxX && y1 >= area.minY && y0 <= area.maxY;
}

/** What the queries read: `x, y` per point, `first point, segment` per piece, `end a, inner a, end b, inner b` per link. */
export interface Geometry {
  positions: Float32Array;
  pieces: Uint32Array;
  links: Uint32Array;
}

export function pieceTouches(g: Geometry, piece: number, area: Bounds): boolean {
  const p = (g.pieces[piece * 2] ?? 0) * 2;
  const ax = g.positions[p] ?? 0;
  const ay = g.positions[p + 1] ?? 0;
  const bx = g.positions[p + 2] ?? 0;
  const by = g.positions[p + 3] ?? 0;
  return overlaps(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), area);
}

/** Mirrors `mark_links` in cull.wgsl. */
export function linkTouches(g: Geometry, link: number, area: Bounds, ribbonHalf: number): boolean {
  const a = (g.links[link * 4] ?? 0) * 2;
  const b = (g.links[link * 4 + 2] ?? 0) * 2;
  const ax = g.positions[a] ?? 0;
  const ay = g.positions[a + 1] ?? 0;
  const bx = g.positions[b] ?? 0;
  const by = g.positions[b + 1] ?? 0;
  const reach = Math.max(Math.hypot(bx - ax, by - ay) * 0.4, ribbonHalf * 6) * 1.5;
  return overlaps(
    Math.min(ax, bx) - reach,
    Math.min(ay, by) - reach,
    Math.max(ax, bx) + reach,
    Math.max(ay, by) + reach,
    area,
  );
}

function pointToBox(x: number, y: number, b: Bounds): number {
  return Math.hypot(Math.max(b.minX - x, x - b.maxX, 0), Math.max(b.minY - y, y - b.maxY, 0));
}

function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length2 = dx * dx + dy * dy;
  const t = length2 > 1e-12 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Liang and Barsky's clip, as `crosses_box` in query.wgsl. */
function crossesBox(ax: number, ay: number, bx: number, by: number, b: Bounds): boolean {
  const [dx, dy] = [bx - ax, by - ay];
  const p = [-dx, dx, -dy, dy];
  const q = [ax - b.minX, b.maxX - ax, ay - b.minY, b.maxY - ay];
  let [t0, t1] = [0, 1];
  for (let k = 0; k < 4; k++) {
    const pk = p[k] ?? 0;
    const qk = q[k] ?? 0;
    if (pk === 0) {
      if (qk < 0) return false;
    } else if (pk < 0) {
      t0 = Math.max(t0, qk / pk);
    } else {
      t1 = Math.min(t1, qk / pk);
    }
  }
  return t0 <= t1;
}

/** Mirrors `segment_to_box` in query.wgsl. */
export function segmentToBox(ax: number, ay: number, bx: number, by: number, b: Bounds): number {
  if (crossesBox(ax, ay, bx, by, b)) return 0;
  return Math.min(
    pointToBox(ax, ay, b),
    pointToBox(bx, by, b),
    pointToSegment(b.minX, b.minY, ax, ay, bx, by),
    pointToSegment(b.maxX, b.maxY, ax, ay, bx, by),
    pointToSegment(b.minX, b.maxY, ax, ay, bx, by),
    pointToSegment(b.maxX, b.minY, ax, ay, bx, by),
  );
}

/** One bit per segment whose ribbon, `half` wide, touches `box`; as `select_box` in query.wgsl. */
export function selectBox(
  g: Geometry,
  grid: PositionGrid,
  segments: number,
  box: Bounds,
  half: number,
  marks: Uint32Array,
  scratch: Uint32Array,
): Uint32Array<ArrayBuffer> {
  const hits = new Uint32Array(Math.ceil(segments / 32));
  const area = { minX: box.minX - half, minY: box.minY - half, maxX: box.maxX + half, maxY: box.maxY + half };
  const count = collect(grid, grid.pieces, area, marks, scratch, (piece) => pieceTouches(g, piece, area));
  for (let i = 0; i < count; i++) {
    const piece = scratch[i] ?? 0;
    const p = (g.pieces[piece * 2] ?? 0) * 2;
    const at = (k: number) => g.positions[p + k] ?? 0;
    if (segmentToBox(at(0), at(1), at(2), at(3), box) <= half) {
      const segment = g.pieces[piece * 2 + 1] ?? 0;
      hits[segment >>> 5] = (hits[segment >>> 5] ?? 0) | (1 << (segment & 31));
    }
  }
  return hits;
}

/** The extent of the points of segments whose bit is set, as `bound_pieces` in query.wgsl. */
export function boundsOfSegments(
  positions: Float32Array,
  starts: Uint32Array,
  pieces: Uint8Array,
  bits: Uint32Array,
): Bounds | undefined {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  eachBit(bits, starts.length, (segment) => {
    const first = starts[segment] ?? 0;
    const last = first + (pieces[segment] ?? 0);
    for (let p = first; p <= last; p++) {
      const x = positions[p * 2] ?? 0;
      const y = positions[p * 2 + 1] ?? 0;
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
  });
  return b.minX <= b.maxX ? b : undefined;
}

/** Calls `f` for each set bit below `limit`, in order. */
export function eachBit(bits: Uint32Array, limit: number, f: (index: number) => void): void {
  for (let word = 0; word < bits.length; word++) {
    let w = bits[word] ?? 0;
    while (w !== 0) {
      const low = w & -w;
      const index = word * 32 + 31 - Math.clz32(low);
      w ^= low;
      if (index < limit) f(index);
    }
  }
}
