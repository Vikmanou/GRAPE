import { describe, expect, it } from 'vitest';
import { hsl, randomColors } from '../../src/engine/style/palette';

function unpack(c: number): [number, number, number, number] {
  return [c & 0xff, (c >>> 8) & 0xff, (c >>> 16) & 0xff, c >>> 24];
}

describe('palette', () => {
  it('converts HSL', () => {
    expect(hsl(0, 1, 0.5)).toEqual([1, 0, 0]);
    expect(hsl(1 / 3, 1, 0.5).map((v) => Math.round(v * 255))).toEqual([0, 255, 0]);
    expect(hsl(0.5, 0, 0.25)).toEqual([0.25, 0.25, 0.25]);
  });

  it('gives each segment a stable opaque colour', () => {
    const a = randomColors(1000, 1);
    expect(randomColors(1000, 1)).toEqual(a);
    expect(randomColors(1000, 2)).not.toEqual(a);
    for (const c of a) expect(unpack(c)[3]).toBe(255);
  });

  it('keeps Bandage saturation and lightness', () => {
    for (const c of randomColors(200, 7)) {
      const [r, g, b] = unpack(c).map((v) => v / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      expect((max + min) / 2).toBeCloseTo(150 / 255, 1);
    }
  });

  it('spreads hues, even over a few segments', () => {
    expect(new Set(randomColors(500, 3)).size).toBeGreaterThan(300);
    const few = [...randomColors(3, 1)].map((c) => unpack(c));
    for (let i = 0; i < few.length; i++) {
      for (let j = 0; j < i; j++) {
        const [a, b] = [few[i] ?? [], few[j] ?? []];
        const distance = a.reduce((sum, v, k) => sum + Math.abs(v - (b[k] ?? 0)), 0);
        expect(distance).toBeGreaterThan(60);
      }
    }
  });
});
