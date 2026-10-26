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
  return mix32(Math.imul(x, 73856093) + Math.imul(y, 19349663) + Math.imul(component, 83492791));
}

export function cellKey(component: number, x: number, y: number): number {
  return (mix32(Math.imul(x, 2654435761) + Math.imul(y, 2246822519) + Math.imul(component, 3266489917)) | 1) >>> 0;
}

/** The bits of `v` as an f32, as the kernels read packed floats. */
export function floatBits(v: number): number {
  return new Uint32Array(new Float32Array([v]).buffer)[0] ?? 0;
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
