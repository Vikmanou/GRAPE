import { describe, expect, it } from 'vitest';
import { detectBackend, type DetectEnv } from '../../src/engine/detect';

function fakeGpu(requestAdapter: () => Promise<GPUAdapter | null>): GPU {
  return { requestAdapter } as unknown as GPU;
}

const adapter = { info: { isFallbackAdapter: false } } as GPUAdapter;
const softwareAdapter = { info: { isFallbackAdapter: true } } as GPUAdapter;

function env(gpu: GPU | undefined, webgl2: boolean): DetectEnv {
  return { gpu, hasWebGL2: () => webgl2 };
}

describe('detectBackend', () => {
  it('prefers WebGPU when an adapter is available', async () => {
    const gpu = fakeGpu(() => Promise.resolve(adapter));
    expect(await detectBackend(env(gpu, true))).toBe('webgpu');
  });

  it('falls back to WebGL2 when there is no navigator.gpu', async () => {
    expect(await detectBackend(env(undefined, true))).toBe('webgl2');
  });

  it('falls back to WebGL2 when requestAdapter resolves null', async () => {
    const gpu = fakeGpu(() => Promise.resolve(null));
    expect(await detectBackend(env(gpu, true))).toBe('webgl2');
  });

  it('falls back to WebGL2 when only a software adapter is available', async () => {
    const gpu = fakeGpu(() => Promise.resolve(softwareAdapter));
    expect(await detectBackend(env(gpu, true))).toBe('webgl2');
  });

  it('falls back to WebGL2 when requestAdapter throws', async () => {
    const gpu = fakeGpu(() => Promise.reject(new Error('blocked')));
    expect(await detectBackend(env(gpu, true))).toBe('webgl2');
  });

  it('reports none when neither backend exists', async () => {
    expect(await detectBackend(env(undefined, false))).toBe('none');
  });
});
