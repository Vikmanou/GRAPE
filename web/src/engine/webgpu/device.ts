import { browserEnv, requestAdapter } from '../core/detect';

export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function createGpuContext(canvas: HTMLCanvasElement): Promise<GpuContext> {
  const adapter = await requestAdapter(browserEnv().gpu);
  if (!adapter) throw new Error('no WebGPU adapter available');
  // The defaults (128 MB bindings) are below what large graphs need and
  // below what most adapters offer.
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
    requiredLimits: {
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxBufferSize: adapter.limits.maxBufferSize,
    },
  });
  const context = canvas.getContext('webgpu');
  if (!context) {
    device.destroy();
    throw new Error('canvas.getContext("webgpu") returned null');
  }
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return { device, context, format };
}
