// Times each pass of a force iteration with GPU timestamps on a lattice of
// `count` nodes: open /tests/gpu/index.html?profile=400000.

import { Buffers, Passes } from '../../src/engine/webgpu/layout/gpu';
import type { Kernels } from '../../src/engine/webgpu/layout/kernels';
import { GpuLevel } from '../../src/engine/webgpu/layout/level';
import { floatBits, random } from './reference';

const ITERATIONS = 10;
/** Timed passes per iteration, an upper bound for the query set. */
const SECTIONS = 9;

export async function profile(device: GPUDevice, kernels: Kernels, count: number): Promise<Record<string, string>> {
  const side = Math.ceil(Math.sqrt(count));
  const rest = 10;
  const next = random(5);
  const positions = new Float32Array(count * 2);
  const nodes = new Uint32Array(count * 4);
  const edges: number[] = [];
  for (let i = 0; i < count; i++) {
    const [x, y] = [i % side, Math.floor(i / side)];
    positions[i * 2] = (x + next() * 0.5) * rest;
    positions[i * 2 + 1] = (y + next() * 0.5) * rest;
    const neighbours = [i - 1, i + 1, i - side, i + side].filter((j) => j >= 0 && j < count);
    nodes.set(
      [
        Math.floor((y / side) * 10),
        floatBits(1 / (1 + neighbours.length)),
        edges.length / 3,
        edges.length / 3 + neighbours.length,
      ],
      i * 4,
    );
    for (const j of neighbours) edges.push(j, floatBits(rest), floatBits(1));
  }
  const shared = new Buffers(device);
  const state = shared.storage('state', 4);
  const energy = shared.storage('energy', 4);
  const level = new GpuLevel(
    kernels,
    device,
    {
      nodes,
      edges: Uint32Array.from(edges),
      heat: new Float32Array(10).fill(30),
      repulsion: rest * rest * 0.25,
      meanRest: rest,
      iterations: 500,
    },
    { state, energy },
    1,
  );
  const querySet = device.createQuerySet({ type: 'timestamp', count: SECTIONS * 2 * ITERATIONS });
  const resolved = device.createBuffer({
    size: querySet.count * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const read = device.createBuffer({
    size: querySet.count * 8,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  try {
    level.write(positions);
    const warm = device.createCommandEncoder();
    const warmPasses = new Passes(warm);
    level.encode(warmPasses, 3);
    warmPasses.end();
    device.queue.submit([warm.finish()]);
    await device.queue.onSubmittedWorkDone();
    const encoder = device.createCommandEncoder();
    const labels: string[] = [];
    const passes = new Passes(encoder, (label) => {
      labels.push(label);
      const at = labels.length * 2 - 2;
      return { querySet, beginningOfPassWriteIndex: at, endOfPassWriteIndex: at + 1 };
    });
    level.encode(passes, ITERATIONS);
    passes.end();
    const slot = labels.length * 2;
    encoder.resolveQuerySet(querySet, 0, querySet.count, resolved, 0);
    encoder.copyBufferToBuffer(resolved, 0, read, 0, resolved.size);
    const started = performance.now();
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const wall = performance.now() - started;
    const times = new BigInt64Array(read.getMappedRange());
    const totals: Record<string, number> = {};
    for (let q = 0; q < slot; q += 2) {
      const label = labels[q / 2] ?? '?';
      totals[label] = (totals[label] ?? 0) + Number((times[q + 1] ?? 0n) - (times[q] ?? 0n)) / 1e6 / ITERATIONS;
    }
    const result: Record<string, string> = { nodes: String(count), wallPerIteration: (wall / ITERATIONS).toFixed(2) };
    for (const [label, ms] of Object.entries(totals)) result[label] = ms.toFixed(2);
    return result;
  } finally {
    read.destroy();
    resolved.destroy();
    querySet.destroy();
    level.destroy();
    shared.destroy();
  }
}
