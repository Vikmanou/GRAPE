import { describe, expect, it } from 'vitest';
import { BAND_WORDS, bandInstances, type HitBands } from '../../src/engine/core/Bands';
import { hitBands, MAX_BANDS } from '../../src/state/search';
import type { SearchResults } from '../../src/workers/protocol/sequence';

function band(segment: number, start: number, end: number, reverse = 0): HitBands {
  return {
    segments: Uint32Array.of(segment),
    reverse: Uint8Array.of(reverse),
    starts: Float32Array.of(start),
    ends: Float32Array.of(end),
    colors: Uint32Array.of(0xff112233),
  };
}

/** `point, from, to` per instance. */
function read(words: Uint32Array<ArrayBuffer>): [number, number, number][] {
  const floats = new Float32Array(words.buffer);
  const out: [number, number, number][] = [];
  for (let at = 0; at < words.length; at += BAND_WORDS) {
    out.push([words[at] ?? 0, floats[at + 2] ?? 0, floats[at + 3] ?? 0]);
  }
  return out;
}

describe('band instances', () => {
  const starts = Uint32Array.of(0, 2, 7);
  const pieces = Uint8Array.of(1, 4, 2);

  it('keeps a band inside one piece, in the piece own fraction', () => {
    expect(read(bandInstances(band(1, 0.25, 0.375), starts, pieces))).toEqual([[3, 0, 0.5]]);
  });

  it('splits a band over the pieces it crosses, open at the joins', () => {
    expect(read(bandInstances(band(1, 0.125, 0.875), starts, pieces))).toEqual([
      [2, 0.5, 1],
      [3, 0, 1],
      [4, 0, 1],
      [5, 0, 0.5],
    ]);
  });

  it('covers a whole segment, and a band ending on a join stays in its piece', () => {
    expect(read(bandInstances(band(0, 0, 1), starts, pieces))).toEqual([[0, 0, 1]]);
    expect(read(bandInstances(band(2, 0, 0.5), starts, pieces))).toEqual([[7, 0, 1]]);
  });

  it('passes on the colour and the strand', () => {
    const words = bandInstances(band(2, 0.5, 1, 1), starts, pieces);
    expect([words[1], words[4], words[5]]).toEqual([2, 0xff112233, 1]);
  });
});

describe('hitBands', () => {
  const results = (parts: number): SearchResults => ({
    names: ['a'],
    lengths: Uint32Array.of(100),
    totals: Uint32Array.of(1),
    hits: Uint32Array.of(0, 100, 0, 100, 100, 100, parts),
    parts: new Uint32Array(parts * 6).map((_, i) => (i % 6 === 5 ? 50 : i % 6 === 4 ? 25 : 0)),
    tooShort: [],
    repeats: 0,
    seedsCut: false,
  });

  it('turns base positions into fractions of the segment', () => {
    const bands = hitBands(results(1), Uint32Array.of(100));
    expect([bands.segments[0], bands.starts[0], bands.ends[0]]).toEqual([0, 0.25, 0.5]);
  });

  it('draws no more than its cap', () => {
    expect(hitBands(results(MAX_BANDS + 1), Uint32Array.of(100)).segments.length).toBe(MAX_BANDS);
  });
});
