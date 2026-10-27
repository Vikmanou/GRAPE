import { describe, expect, it } from 'vitest';
import { anchor, placeLabels, type Chains } from '../../src/engine/webgl2/labels';

const at = { centerX: 0, centerY: 0, zoom: 1, width: 200, height: 100, advance: 6, lineHeight: 10, cell: 4 };

/** Segments of one point pair each, at `xy`, with labels `chars` wide on one line, ranked in order. */
function chains(xy: [number, number][]): { c: Chains; sizes: Uint32Array } {
  const positions = Float32Array.from(xy.flatMap(([x, y]) => [x - 1, y, x + 1, y]));
  const n = xy.length;
  const c = {
    positions,
    starts: Uint32Array.from({ length: n }, (_, i) => i * 2),
    pieces: new Uint8Array(n).fill(1),
  };
  const sizes = new Uint32Array(n * 2);
  for (let i = 0; i < n; i++) {
    sizes[i] = i;
    sizes[n + i] = 5 | (1 << 16);
  }
  return { c, sizes };
}

function box(c: Chains, segment: number): number[] {
  const [x, y] = anchor(c, segment);
  const [sx, sy] = [x * at.zoom + at.width / 2, y * at.zoom + at.height / 2];
  return [sx - 15, sy - 5, sx + 15, sy + 5];
}

describe('CPU label placement', () => {
  it('never places overlapping labels and prefers the better ranked', () => {
    const next = (() => {
      let s = 7;
      return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    })();
    const xy = Array.from({ length: 60 }, (): [number, number] => [next() * 220 - 110, next() * 120 - 60]);
    const { c, sizes } = chains(xy);
    const placed = placeLabels(c, sizes, xy.keys(), at);
    expect(placed.segments.length).toBeGreaterThan(3);
    const cell = (v: number) => Math.floor(v / at.cell);
    const cells = Array.from(placed.segments, (s) => box(c, s).map(cell));
    cells.forEach((a, i) => {
      for (const b of cells.slice(i + 1)) {
        const [a0 = 0, a1 = 0, a2 = 0, a3 = 0] = a;
        const [b0 = 0, b1 = 0, b2 = 0, b3 = 0] = b;
        expect(a2 < b0 || b2 < a0 || a3 < b1 || b3 < a1).toBe(true);
      }
    });
    expect(Array.from(placed.ranks)).toEqual([...placed.ranks].sort((a, b) => a - b));
    expect(placed.segments[0]).toBe(0);
  });

  it('keeps the best of two labels that share cells, and both when apart', () => {
    const { c, sizes } = chains([
      [0, 0],
      [4, 2],
      [60, 0],
    ]);
    const placed = placeLabels(c, sizes, [2, 1, 0], at);
    expect(Array.from(placed.segments)).toEqual([0, 2]);
  });

  it('skips labels outside the canvas and segments without one', () => {
    const { c, sizes } = chains([
      [500, 0],
      [0, 0],
    ]);
    sizes[3] = 0;
    expect(placeLabels(c, sizes, [0, 1], at).segments.length).toBe(0);
  });
});
