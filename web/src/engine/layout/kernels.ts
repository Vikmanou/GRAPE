import forces from '../shaders/forces.wgsl?raw';
import grid from '../shaders/grid.wgsl?raw';
import common from '../shaders/layout-common.wgsl?raw';
import present from '../shaders/present.wgsl?raw';
import prolong from '../shaders/prolong.wgsl?raw';
import scan from '../shaders/scan.wgsl?raw';

const SOURCES = {
  scan,
  grid: common + grid,
  forces: common + forces,
  prolong: common + prolong,
  present: common + present,
};

const ENTRY_POINTS = {
  scanBlocks: ['scan', 'scan_blocks'],
  addSums: ['scan', 'add_sums'],
  bin: ['grid', 'bin'],
  scatter: ['grid', 'scatter'],
  sortBuckets: ['grid', 'sort_buckets'],
  repel: ['forces', 'repel'],
  pullAndMove: ['forces', 'pull_and_move'],
  advance: ['forces', 'advance'],
  pullChildren: ['prolong', 'pull_children'],
  placeChildren: ['prolong', 'place_children'],
  findAncestors: ['present', 'find_ancestors'],
  present: ['present', 'present'],
  bound: ['present', 'bound'],
} as const satisfies Record<string, readonly [keyof typeof SOURCES, string]>;

export type Kernels = Record<keyof typeof ENTRY_POINTS, GPUComputePipeline>;

/** Compiled once per device, off the main thread where the browser can. */
export async function createKernels(device: GPUDevice): Promise<Kernels> {
  const modules = new Map(
    Object.entries(SOURCES).map(([label, code]) => [label, device.createShaderModule({ label, code })]),
  );
  await Promise.all([...modules.values()].map(checkCompiled));
  const names = Object.keys(ENTRY_POINTS) as (keyof Kernels)[];
  const pipelines = await Promise.all(
    names.map((name) => {
      const [source, entryPoint] = ENTRY_POINTS[name];
      const module = modules.get(source);
      if (!module) throw new Error(`no shader ${source}`);
      return device.createComputePipelineAsync({ label: entryPoint, layout: 'auto', compute: { module, entryPoint } });
    }),
  );
  const kernels: Partial<Kernels> = {};
  names.forEach((name, i) => {
    const pipeline = pipelines[i];
    if (pipeline) kernels[name] = pipeline;
  });
  return kernels as Kernels;
}

async function checkCompiled(module: GPUShaderModule): Promise<void> {
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((m) => m.type === 'error');
  if (errors.length > 0) {
    throw new Error(`${module.label}: ${errors.map((m) => `${m.lineNum}:${m.linePos} ${m.message}`).join('; ')}`);
  }
}
