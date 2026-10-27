import { describe, expect, it } from 'vitest';
import type { CellLists, PositionGrid } from '../../src/workers/protocol/layout';
import {
  boundsOfSegments,
  collect,
  coversGrid,
  linkTouches,
  pieceTouches,
  segmentToBox,
  selectBox,
  type Geometry,
} from '../../src/engine/webgl2/grid';
import type { Bounds } from '../../src/engine/core/camera';

/** A small seeded generator, so failures repeat. */
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Builds lists as gfa-core's `Grid::fill` does, over boxes `x0, y0, x1, y1`. */
function lists(frame: Omit<PositionGrid, 'pieces' | 'links'>, boxes: number[][]): CellLists {
  const per: number[][] = Array.from({ length: frame.columns * frame.rows }, () => []);
  const wide: number[] = [];
  const col = (x: number) => Math.min(frame.columns - 1, Math.max(0, Math.floor((x - frame.minX) / frame.cell)));
  const row = (y: number) => Math.min(frame.rows - 1, Math.max(0, Math.floor((y - frame.minY) / frame.cell)));
  boxes.forEach(([x0 = 0, y0 = 0, x1 = 0, y1 = 0], i) => {
    const [c0, c1, r0, r1] = [col(x0), col(x1), row(y0), row(y1)];
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 16) {
      wide.push(i);
      return;
    }
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) per[r * frame.columns + c]?.push(i);
  });
  const starts = [0];
  for (const cell of per) starts.push((starts.at(-1) ?? 0) + cell.length);
  return { starts: Uint32Array.from(starts), items: Uint32Array.from(per.flat()), wide: Uint32Array.from(wide) };
}

function scene(seed: number, points: number): { g: Geometry; grid: PositionGrid } {
  const next = random(seed);
  const positions = Float32Array.from({ length: points * 2 }, () => next() * 1000 - 500);
  const pieces = Uint32Array.from({ length: (points - 1) * 2 }, (_, i) => (i % 2 === 0 ? i / 2 : Math.floor(i / 6)));
  const links = Uint32Array.from({ length: 40 }, () => Math.floor(next() * points));
  const g = { positions, pieces, links };
  const frame = { minX: -600, minY: -600, cell: 60, columns: 20, rows: 20 };
  const pieceBoxes = Array.from({ length: points - 1 }, (_, p) => {
    const [ax = 0, ay = 0, bx = 0, by = 0] = positions.subarray(p * 2, p * 2 + 4);
    return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
  });
  const linkBoxes = Array.from({ length: 10 }, (_, l) => {
    const [a, b] = [links[l * 4] ?? 0, links[l * 4 + 2] ?? 0];
    const [ax = 0, ay = 0, bx = 0, by = 0] = [
      positions[a * 2],
      positions[a * 2 + 1],
      positions[b * 2],
      positions[b * 2 + 1],
    ];
    const reach = Math.max(Math.hypot(bx - ax, by - ay) * 0.4, 15) * 1.5;
    return [Math.min(ax, bx) - reach, Math.min(ay, by) - reach, Math.max(ax, bx) + reach, Math.max(ay, by) + reach];
  });
  return { g, grid: { ...frame, pieces: lists(frame, pieceBoxes), links: lists(frame, linkBoxes) } };
}

const AREAS: Bounds[] = [
  { minX: -50, minY: -80, maxX: 120, maxY: 40 },
  { minX: 300, minY: 300, maxX: 900, maxY: 900 },
  { minX: -2000, minY: -2000, maxX: -1500, maxY: -1500 },
];

describe('grid queries', () => {
  it('find exactly the pieces and links that touch an area, in order', () => {
    for (const seed of [1, 2, 3]) {
      const { g, grid } = scene(seed, 400);
      const marks = new Uint32Array(64);
      const out = new Uint32Array(400);
      for (const area of AREAS) {
        const count = collect(grid, grid.pieces, area, marks, out, (p) => pieceTouches(g, p, area));
        const want = Array.from({ length: 399 }, (_, p) => p).filter((p) => pieceTouches(g, p, area));
        expect(Array.from(out.subarray(0, count))).toEqual(want);
        const links = collect(grid, grid.links, area, marks, out, (l) => linkTouches(g, l, area, 2.5));
        const wantLinks = Array.from({ length: 10 }, (_, l) => l).filter((l) => linkTouches(g, l, area, 2.5));
        expect(Array.from(out.subarray(0, links))).toEqual(wantLinks);
        expect(marks.every((w) => w === 0)).toBe(true);
      }
    }
  });

  it('knows when an area holds the whole grid', () => {
    const { grid } = scene(1, 10);
    expect(coversGrid(grid, { minX: -600, minY: -600, maxX: 600, maxY: 600 })).toBe(true);
    expect(coversGrid(grid, AREAS[0] ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 })).toBe(false);
  });

  it('box select matches testing every piece', () => {
    const { g, grid } = scene(4, 300);
    const segments = 100;
    const box = { minX: -100, minY: -100, maxX: 150, maxY: 60 };
    const hits = selectBox(g, grid, segments, box, 2.5, new Uint32Array(16), new Uint32Array(300));
    const want = new Uint32Array(Math.ceil(segments / 32));
    for (let p = 0; p < 299; p++) {
      const [ax = 0, ay = 0, bx = 0, by = 0] = g.positions.subarray(p * 2, p * 2 + 4);
      const s = g.pieces[p * 2 + 1] ?? 0;
      if (segmentToBox(ax, ay, bx, by, box) <= 2.5) want[s >>> 5] = (want[s >>> 5] ?? 0) | (1 << (s & 31));
    }
    expect(Array.from(hits)).toEqual(Array.from(want));
    expect(want.some((w) => w !== 0)).toBe(true);
  });

  it('measures the distance from a segment to a box', () => {
    const box = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
    expect(segmentToBox(-5, 5, 15, 5, box)).toBe(0);
    expect(segmentToBox(-5, -5, -5, 20, box)).toBe(5);
    expect(segmentToBox(13, 14, 20, 20, box)).toBe(5);
  });

  it('bounds the points of the selected segments', () => {
    const positions = Float32Array.from([0, 0, 1, 1, 5, 5, 9, -2, 10, 3]);
    const starts = Uint32Array.from([0, 2]);
    const pieces = Uint8Array.from([1, 2]);
    expect(boundsOfSegments(positions, starts, pieces, Uint32Array.from([0b10]))).toEqual({
      minX: 5,
      minY: -2,
      maxX: 10,
      maxY: 5,
    });
    expect(boundsOfSegments(positions, starts, pieces, Uint32Array.from([0]))).toBeUndefined();
  });
});
