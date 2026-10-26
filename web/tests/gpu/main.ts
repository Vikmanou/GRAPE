// Runs each GPU kernel check and reports to the page, for gpu.spec.ts.

import { browserEnv, requestAdapter } from '../../src/engine/core/detect';
import { createKernels } from '../../src/engine/webgpu/layout/kernels';
import { checks } from './checks';
import { profile } from './profile';

async function main(): Promise<Record<string, string>> {
  const adapter = await requestAdapter(browserEnv().gpu);
  if (!adapter) return { webgpu: 'none' };
  const timestamps = adapter.features.has('timestamp-query');
  const device = await adapter.requestDevice({
    requiredFeatures: timestamps ? ['timestamp-query'] : [],
    requiredLimits: { maxStorageBuffersPerShaderStage: adapter.limits.maxStorageBuffersPerShaderStage },
  });
  const errors: string[] = [];
  device.addEventListener('uncapturederror', (event) => errors.push(event.error.message));
  const kernels = await createKernels(device);
  const profiled = Number(new URLSearchParams(location.search).get('profile'));
  if (profiled > 0) {
    if (!timestamps) return { profile: 'this adapter has no timestamp queries' };
    return profile(device, kernels, profiled);
  }
  const results: Record<string, string> = {};
  for (const [name, check] of Object.entries(checks)) {
    try {
      await check(device, kernels);
      results[name] = errors.length > 0 ? `GPU error: ${errors.join('; ')}` : 'ok';
    } catch (error) {
      results[name] = error instanceof Error ? error.message : String(error);
    }
    errors.length = 0;
  }
  return results;
}

void main()
  .catch((error: unknown) => ({ harness: error instanceof Error ? error.message : String(error) }))
  .then((results) => {
    const log = document.getElementById('log');
    if (log) log.textContent = JSON.stringify(results, null, 2);
    document.body.dataset.results = JSON.stringify(results);
  });
