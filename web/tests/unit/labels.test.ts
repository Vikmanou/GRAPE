import { describe, expect, it } from 'vitest';
import { Atlas } from '../../src/engine/text/Atlas';
import { GLYPH_FLOATS, labelMetrics, layoutLabels } from '../../src/engine/text/layoutLabels';

// A monospace atlas at size 10: every glyph 6 wide, 8 tall, advancing 6.
const atlas = new Atlas(
  {
    size: 10,
    lineHeight: 12,
    base: 9,
    distanceRange: 8,
    width: 100,
    height: 100,
    glyphs: [32, 63, 65, 66].map((code, i) => [code, i * 10, 0, code === 32 ? 0 : 6, 8, 0, 2, 6]),
  },
  {} as ImageBitmap,
);

describe('label layout', () => {
  it('measures the box placement claims', () => {
    expect(labelMetrics(atlas, 20)).toEqual({ advance: 12, lineHeight: 24 });
  });

  it('centres each line about the anchor and tags glyphs with their segment', () => {
    const glyphs = layoutLabels([{ segment: 1_000_001, text: 'AB\nA' }], atlas, 20);
    expect(glyphs.length).toBe(3 * GLYPH_FLOATS);
    const at = (g: number, k: number) => glyphs[g * GLYPH_FLOATS + k];
    // Two lines of 24 px around the anchor; the first two glyphs wide, the second one.
    expect([at(0, 0), at(0, 1)]).toEqual([-12, -24 + 4]);
    expect([at(1, 0), at(2, 0), at(2, 1)]).toEqual([0, -6, 4]);
    expect(new Uint32Array(glyphs.buffer)[GLYPH_FLOATS * 2 + 8]).toBe(1_000_001);
  });

  it('skips spaces and draws characters outside the atlas as ?', () => {
    const glyphs = layoutLabels([{ segment: 0, text: 'A é' }], atlas, 10);
    expect(glyphs.length).toBe(2 * GLYPH_FLOATS);
    expect(glyphs[GLYPH_FLOATS + 4]).toBeCloseTo(0.1);
  });
});
