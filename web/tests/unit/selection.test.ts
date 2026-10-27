import { describe, expect, it } from 'vitest';
import { Selection } from '../../src/engine/core/Selection';

function selection(segments: number): Selection {
  const s = new Selection();
  s.reset(segments);
  return s;
}

describe('Selection', () => {
  it('replaces, adds and toggles', () => {
    const s = selection(70);
    s.replace([3, 64]);
    s.add([3, 5, 99]);
    expect(s.count).toBe(3);
    s.toggle(3);
    s.toggle(69);
    expect([3, 5, 64, 69].map((i) => s.has(i))).toEqual([false, true, true, true]);
    expect(s.count).toBe(3);
    s.replace([40]);
    expect(s.count).toBe(1);
    expect(s.single).toBe(40);
  });

  it('inverts within the segment count', () => {
    const s = selection(37);
    s.replace([0, 36]);
    s.invert();
    expect(s.count).toBe(35);
    expect(s.has(0) || s.has(36)).toBe(false);
    expect(s.snapshot()[1]).toBe(0b1111);
  });

  it('adds a bitset and recounts', () => {
    const s = selection(64);
    s.replace([1]);
    s.addBits(Uint32Array.of(0b110, 0x80000000));
    expect(s.count).toBe(3);
    expect(s.single).toBeUndefined();
    s.clear();
    expect(s.count).toBe(0);
  });
});
