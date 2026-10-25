import { describe, expect, it } from 'vitest';
import { FrameCounter } from '../../src/engine/frames';

function run(counter: FrameCounter, frames: number, gapMs: number, gpuMs: number) {
  let stats;
  for (let i = 0; i <= frames; i++) stats = counter.record(1000 + i * gapMs, 1, gpuMs) ?? stats;
  return stats;
}

describe('FrameCounter', () => {
  it('reports animation frames per second over continuous drawing', () => {
    expect(run(new FrameCounter(), 61, 1000 / 60, 0)?.fps).toBeCloseTo(60, 0);
  });

  it('caps the rate at what the GPU keeps up with', () => {
    expect(run(new FrameCounter(), 61, 1000 / 60, 40)?.fps).toBeCloseTo(25, 5);
  });

  it('ignores frames drawn far apart', () => {
    expect(run(new FrameCounter(), 30, 200, 0)).toBeUndefined();
  });
});
