import type { Quality } from '../protocol/layout';

// Balanced is the CPU reference's budget (gfa-core `LayoutOptions::default`).
const COARSEST_ITERATIONS = 500;
const REFINE_ITERATIONS = 50;
const SCALE: Record<Quality, number> = { fast: 0.5, balanced: 1, best: 2 };

export function iterationsFor(quality: Quality): { coarsest: number; refine: number } {
  return {
    coarsest: Math.round(COARSEST_ITERATIONS * SCALE[quality]),
    refine: Math.round(REFINE_ITERATIONS * SCALE[quality]),
  };
}
