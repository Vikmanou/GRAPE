import { Buffers, Passes, readBuffer } from '../../src/engine/webgpu/layout/gpu';
import { Grid, gridSizes } from '../../src/engine/webgpu/layout/grid';
import type { Kernels } from '../../src/engine/webgpu/layout/kernels';
import { encodeParams } from '../../src/engine/webgpu/layout/params';
import { Scan } from '../../src/engine/webgpu/layout/scan';
import { culling } from './cull';
import { forceIteration } from './forces';
import { picking } from './pick';
import { boxSelect } from './query';
import { assert, cellHash, cellKey, random } from './reference';

export type Check = (device: GPUDevice, kernels: Kernels) => Promise<void>;

async function scanOnce(device: GPUDevice, kernels: Kernels, input: Uint32Array<ArrayBuffer>): Promise<Uint32Array> {
  const buffers = new Buffers(device);
  try {
    const data = buffers.upload('scan input', input);
    const mirror = buffers.storage('scan mirror', input.byteLength);
    const scan = new Scan(kernels, buffers, data, input.length, mirror);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    scan.encode(pass);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const output = new Uint32Array(await readBuffer(device, data), 0, input.length);
    const mirrored = new Uint32Array(await readBuffer(device, mirror), 0, input.length);
    assert(output.join() === mirrored.join(), `length ${input.length}: the mirror differs`);
    return output;
  } finally {
    buffers.destroy();
  }
}

const prefixSum: Check = async (device, kernels) => {
  const next = random(1);
  for (const length of [1, 2, 511, 512, 513, 262_144, 262_145, 1_000_003]) {
    const input = Uint32Array.from({ length }, () => Math.floor(next() * 8));
    const output = await scanOnce(device, kernels, input);
    let sum = 0;
    for (let i = 0; i < length; i++) {
      assert(output[i] === sum, `length ${length}: index ${i} is ${output[i]}, expected ${sum}`);
      sum += input[i] ?? 0;
    }
  }
};

// Points sit well inside their fine cells, so the GPU's and the CPU's floor
// agree even though WGSL division may be off by an ulp or two.
const binning: Check = async (device, kernels) => {
  const count = 50_000;
  const [cell, coarseCell] = [10, 40];
  const next = random(2);
  const positions = new Float32Array(count * 2);
  const nodes = new Uint32Array(count * 4);
  for (let i = 0; i < count; i++) {
    positions[i * 2] = (Math.floor(next() * 300 - 100) + 0.2 + next() * 0.6) * cell;
    positions[i * 2 + 1] = (Math.floor(next() * 300 - 100) + 0.2 + next() * 0.6) * cell;
    nodes[i * 4] = Math.floor(next() * 3);
  }
  const sizes = gridSizes(count);
  const buffers = new Buffers(device);
  try {
    const params = buffers.uniform(
      'params',
      encodeParams({
        count,
        fineMask: sizes.fine - 1,
        coarseMask: sizes.coarse - 1,
        seed: 0,
        cell,
        coarseCell,
        repulsion: 0,
        iterations: 0,
      }),
    );
    const grid = new Grid(
      kernels,
      buffers,
      params,
      [buffers.upload('positions', positions)],
      buffers.upload('nodes', nodes),
      count,
      { state: buffers.storage('state', 4), energy: buffers.storage('energy', 4) },
    );
    const encoder = device.createCommandEncoder();
    const passes = new Passes(encoder);
    grid.encode(passes, 0);
    passes.end();
    device.queue.submit([encoder.finish()]);
    const starts = new Uint32Array(await readBuffer(device, grid.starts));
    const sorted = new Uint32Array(await readBuffer(device, grid.sorted), 0, count);
    const coarse = new Int32Array(await readBuffer(device, grid.coarse));

    const expected = new Map<number, number[]>();
    const cells = new Map<string, { count: number; x: number; y: number; key: number; start: number }>();
    for (let i = 0; i < count; i++) {
      const [x, y, c] = [positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0, nodes[i * 4] ?? 0];
      const bucket = (cellHash(c, Math.floor(x / cell), Math.floor(y / cell)) & (sizes.fine - 1)) >>> 0;
      expected.set(bucket, [...(expected.get(bucket) ?? []), i]);
      const [cx, cy] = [Math.floor(x / coarseCell), Math.floor(y / coarseCell)];
      const name = `${c},${cx},${cy}`;
      const sum = cells.get(name) ?? {
        count: 0,
        x: 0,
        y: 0,
        key: cellKey(c, cx, cy) | 0,
        start: (cellHash(c, cx, cy) & (sizes.coarse - 1)) >>> 0,
      };
      sum.count++;
      sum.x += Math.trunc(((x - cx * coarseCell) / coarseCell) * 1024);
      sum.y += Math.trunc(((y - cy * coarseCell) / coarseCell) * 1024);
      cells.set(name, sum);
    }
    assert(starts[sizes.fine] === count, `total ${starts[sizes.fine]}`);
    for (let b = 0; b < sizes.fine; b++) {
      const members = Array.from(sorted.subarray(starts[b] ?? 0, starts[b + 1] ?? 0));
      const want = expected.get(b) ?? [];
      assert(members.join() === want.join(), `bucket ${b}: ${members.join()} vs ${want.join()}`);
    }
    let occupied = 0;
    for (let s = 0; s < sizes.coarse; s++) if (coarse[s * 4] !== 0) occupied++;
    assert(occupied === cells.size, `${occupied} coarse slots used for ${cells.size} cells`);
    for (const [name, want] of cells) {
      let slot = want.start;
      while (coarse[slot * 4] !== want.key && coarse[slot * 4] !== 0) slot = (slot + 1) & (sizes.coarse - 1);
      assert(coarse[slot * 4] === want.key, `cell ${name} not found`);
      const got = { count: coarse[slot * 4 + 1] ?? 0, x: coarse[slot * 4 + 2] ?? 0, y: coarse[slot * 4 + 3] ?? 0 };
      assert(got.count === want.count, `cell ${name}: count ${got.count} vs ${want.count}`);
      assert(Math.abs(got.x - want.x) <= want.count && Math.abs(got.y - want.y) <= want.count, `cell ${name} sums`);
    }
  } finally {
    buffers.destroy();
  }
};

export const checks: Record<string, Check> = { prefixSum, binning, forceIteration, culling, picking, boxSelect };
