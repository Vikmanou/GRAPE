// CPU ports of the WGSL helpers in layout-common.wgsl, for checking kernels.

export function mix32(x: number): number {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function cellHash(component: number, x: number, y: number): number {
  const h = mix32(component + 0x9e3779b9);
  return mix32(mix32(h ^ (x >>> 0)) ^ (y >>> 0));
}

export function coarseKey(component: number, x: number, y: number): number {
  return (mix32(cellHash(component, x, y) ^ 0x68e31da4) | 1) >>> 0;
}

/** SplitMix32-style generator, so checks are repeatable. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x9e3779b9) >>> 0;
    return mix32(state) / 2 ** 32;
  };
}

export function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
