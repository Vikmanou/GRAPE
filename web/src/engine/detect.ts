/** Which GPU backend this browser can run. */
export type Backend = 'webgpu' | 'webgl2' | 'none';

/** Browser capabilities `detectBackend` depends on, injectable for tests. */
export interface DetectEnv {
  gpu: GPU | undefined;
  hasWebGL2: () => boolean;
}

export function browserEnv(): DetectEnv {
  return {
    // `navigator.gpu` is typed as always present, but is missing in browsers
    // without WebGPU and in insecure contexts.
    gpu: 'gpu' in navigator ? navigator.gpu : undefined,
    hasWebGL2: () => {
      try {
        return document.createElement('canvas').getContext('webgl2') !== null;
      } catch {
        return false;
      }
    },
  };
}

/** Requests a high-performance adapter, or null if WebGPU is unavailable. */
export async function requestAdapter(gpu: GPU | undefined): Promise<GPUAdapter | null> {
  if (!gpu) return null;
  try {
    return await gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    // Some browsers throw instead of resolving null; treat both the same.
    return null;
  }
}

/**
 * Prefers WebGPU with a real adapter, then WebGL2, then reports none. The
 * probe adapter is discarded: an adapter can create only one device, so the
 * engine requests its own.
 */
export async function detectBackend(env: DetectEnv = browserEnv()): Promise<Backend> {
  if (await requestAdapter(env.gpu)) return 'webgpu';
  return env.hasWebGL2() ? 'webgl2' : 'none';
}
