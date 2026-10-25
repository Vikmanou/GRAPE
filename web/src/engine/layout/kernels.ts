import forces from '../shaders/forces.wgsl?raw';
import common from '../shaders/layout-common.wgsl?raw';
import grid from '../shaders/grid.wgsl?raw';
import scan from '../shaders/scan.wgsl?raw';

export interface Kernels {
  scanBlocks: GPUComputePipeline;
  addSums: GPUComputePipeline;
  bin: GPUComputePipeline;
  scatter: GPUComputePipeline;
  sortBuckets: GPUComputePipeline;
  repel: GPUComputePipeline;
  pullAndMove: GPUComputePipeline;
  advance: GPUComputePipeline;
}

/** Compiled once per device, off the main thread where the browser can. */
export async function createKernels(device: GPUDevice): Promise<Kernels> {
  const modules = {
    scan: device.createShaderModule({ label: 'scan', code: scan }),
    grid: device.createShaderModule({ label: 'grid', code: common + grid }),
    forces: device.createShaderModule({ label: 'forces', code: common + forces }),
  };
  await Promise.all(Object.values(modules).map(checkCompiled));
  const pipeline = (module: keyof typeof modules, entryPoint: string) =>
    device.createComputePipelineAsync({
      label: entryPoint,
      layout: 'auto',
      compute: { module: modules[module], entryPoint },
    });
  const [scanBlocks, addSums, bin, scatter, sortBuckets, repel, pullAndMove, advance] = await Promise.all([
    pipeline('scan', 'scan_blocks'),
    pipeline('scan', 'add_sums'),
    pipeline('grid', 'bin'),
    pipeline('grid', 'scatter'),
    pipeline('grid', 'sort_buckets'),
    pipeline('forces', 'repel'),
    pipeline('forces', 'pull_and_move'),
    pipeline('forces', 'advance'),
  ]);
  return { scanBlocks, addSums, bin, scatter, sortBuckets, repel, pullAndMove, advance };
}

async function checkCompiled(module: GPUShaderModule): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    throw new Error(`${module.label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  }
}
