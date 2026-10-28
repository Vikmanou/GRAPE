import { describe, expect, it } from 'vitest';
import { hiddenBy, shownLabelSizes, UNREACHED, withoutHidden } from '../../src/engine/core/Visibility';

// 0 - 1 - 2 in component 0, 3 alone in component 1.
const data = {
  components: Uint32Array.from([0, 0, 0, 1]),
  depth: Float32Array.from([5, NaN, 50, 10]),
  linkFrom: Uint32Array.from([0, 1]),
  linkTo: Uint32Array.from([1, 2]),
};

const hiddenIds = (bits: Uint32Array) => [0, 1, 2, 3].filter((s) => ((bits[s >>> 5] ?? 0) >>> (s & 31)) & 1);

describe('visibility', () => {
  it('shows everything without a filter', () => {
    const hidden = hiddenBy({}, data);
    expect(hiddenIds(hidden.segments)).toEqual([]);
    expect(hidden.visible).toBe(4);
  });

  it('hides beyond the neighbourhood and the links that touch hidden segments', () => {
    const distances = Uint8Array.from([0, 1, 2, UNREACHED]);
    const hidden = hiddenBy({ neighbourhood: { distances, steps: 1 } }, data);
    expect(hiddenIds(hidden.segments)).toEqual([2, 3]);
    expect(hidden.links[0]).toBe(0b10);
    expect(hidden.visible).toBe(2);
  });

  it('combines component, size and depth filters, keeping unknown depths', () => {
    const lengths = Float64Array.from([300, 10]);
    expect(hiddenIds(hiddenBy({ components: Uint8Array.of(0, 1) }, data).segments)).toEqual([0, 1, 2]);
    expect(hiddenIds(hiddenBy({ minComponentLength: { bases: 100, lengths } }, data).segments)).toEqual([3]);
    expect(hiddenIds(hiddenBy({ depth: { min: 6, max: 20 } }, data).segments)).toEqual([0, 2]);
  });

  it('masks selections and label sizes', () => {
    const hidden = Uint32Array.of(0b0101);
    expect(withoutHidden(Uint32Array.of(0b1111), hidden)[0]).toBe(0b1010);
    const sizes = Uint32Array.from([0, 1, 2, 3, 9, 9, 9, 9]);
    expect(Array.from(shownLabelSizes(sizes, hidden))).toEqual([0, 1, 2, 3, 0, 9, 0, 9]);
  });
});
