import { describe, expect, it } from 'vitest';
import { iterationsFor } from '../../src/workers/layout/quality';

describe('iterationsFor', () => {
  it('scales the reference budget', () => {
    expect(iterationsFor('balanced')).toEqual({ coarsest: 500, refine: 50 });
    expect(iterationsFor('fast')).toEqual({ coarsest: 250, refine: 25 });
    expect(iterationsFor('best')).toEqual({ coarsest: 1000, refine: 100 });
  });
});
