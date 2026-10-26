// One force iteration on the GPU against the same maths in f64 on the CPU.

import { Buffers, Passes, readBuffer } from '../../src/engine/layout/gpu';
import type { Kernels } from '../../src/engine/layout/kernels';
import { COARSE_PER_CELL, FAR_REACH, GpuLevel, type LevelInput } from '../../src/engine/layout/level';
import { assert, floatBits, random } from './reference';

const COLD = 0.4;
const FIXED = 1024;

interface Graph {
  input: LevelInput;
  positions: Float32Array<ArrayBuffer>;
  component: number[];
  step: number[];
  adjacency: { to: number; rest: number }[][];
}

function makeGraph(): Graph {
  const next = random(3);
  const sizes = [3000, 900, 100];
  const heatOf = [30, 15, 0];
  const component: number[] = [];
  sizes.forEach((size, c) => {
    for (let k = 0; k < size; k++) component.push(c);
  });
  const n = component.length;
  const adjacency: { to: number; rest: number }[][] = Array.from({ length: n }, () => []);
  const link = (a: number, b: number) => {
    const rest = 10 + next() * 10;
    adjacency[a]?.push({ to: b, rest });
    adjacency[b]?.push({ to: a, rest });
  };
  for (let i = 0; i + 1 < n; i++) if (component[i] === component[i + 1]) link(i, i + 1);
  for (let k = 0; k < 600; k++) {
    const a = Math.floor(next() * 3000);
    const b = Math.floor(next() * 3000);
    if (a !== b) link(a, b);
  }
  const positions = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    positions[i * 2] = next() * 400;
    positions[i * 2 + 1] = next() * 400;
  }
  const nodes = new Uint32Array(n * 4);
  const edges: number[] = [];
  const step: number[] = [];
  let rests = 0;
  for (let i = 0; i < n; i++) {
    const list = adjacency[i] ?? [];
    step.push(Math.fround(1 / (1 + list.length)));
    nodes.set([component[i] ?? 0, floatBits(step[i] ?? 0), edges.length / 3, edges.length / 3 + list.length], i * 4);
    for (const { to, rest } of list) {
      edges.push(to, floatBits(rest), floatBits(1));
      rests += rest;
    }
  }
  const meanRest = rests / (edges.length / 3);
  const input: LevelInput = {
    nodes,
    edges: Uint32Array.from(edges),
    heat: Float32Array.from(heatOf),
    repulsion: meanRest * meanRest * 0.25,
    meanRest,
    iterations: 50,
  };
  return { input, positions, component, step, adjacency };
}

function cpuIteration(g: Graph, cell: number): Float64Array {
  const p = g.positions;
  const n = g.component.length;
  const coarseCell = cell * COARSE_PER_CELL;
  const at = (i: number): [number, number] => [p[i * 2] ?? 0, p[i * 2 + 1] ?? 0];
  const fine = (i: number): [number, number] => {
    const [x, y] = at(i);
    return [Math.floor(x / cell), Math.floor(y / cell)];
  };
  const coarseOf = (i: number): [number, number] => {
    const [fx, fy] = fine(i);
    return [Math.floor(fx / COARSE_PER_CELL), Math.floor(fy / COARSE_PER_CELL)];
  };
  const offset = (i: number): [number, number] => {
    const [x, y] = at(i);
    const [cx, cy] = coarseOf(i);
    return [
      Math.trunc(((x - cx * coarseCell) / coarseCell) * FIXED),
      Math.trunc(((y - cy * coarseCell) / coarseCell) * FIXED),
    ];
  };
  const members = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = `${g.component[i]},${coarseOf(i).join()}`;
    members.set(key, [...(members.get(key) ?? []), i]);
  }
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    const comp = g.component[i] ?? 0;
    const heat = g.input.heat[comp] ?? 0;
    const [x, y] = at(i);
    if (heat === 0) {
      out.set([x, y], i * 2);
      continue;
    }
    let [fx, fy] = [0, 0];
    const [hx, hy] = fine(i);
    const near = new Set<number>();
    for (let j = 0; j < n; j++) {
      const [jx, jy] = fine(j);
      if (g.component[j] !== comp || Math.abs(jx - hx) > 1 || Math.abs(jy - hy) > 1) continue;
      near.add(j);
      if (j === i) continue;
      const [qx, qy] = at(j);
      const [dx, dy] = [x - qx, y - qy];
      const d2 = dx * dx + dy * dy;
      fx += dx / d2;
      fy += dy / d2;
    }
    const [ox, oy] = coarseOf(i);
    for (let cy = oy - FAR_REACH; cy <= oy + FAR_REACH; cy++) {
      for (let cx = ox - FAR_REACH; cx <= ox + FAR_REACH; cx++) {
        const far = (members.get(`${comp},${cx},${cy}`) ?? []).filter((j) => !near.has(j));
        if (far.length === 0) continue;
        const [sx, sy] = far.reduce(([ax, ay], j) => [ax + offset(j)[0], ay + offset(j)[1]], [0, 0]);
        const centroidX = (cx + sx / (far.length * FIXED)) * coarseCell;
        const centroidY = (cy + sy / (far.length * FIXED)) * coarseCell;
        const [dx, dy] = [x - centroidX, y - centroidY];
        const d2 = Math.max(dx * dx + dy * dy, 1e-4);
        fx += (far.length * dx) / d2;
        fy += (far.length * dy) / d2;
      }
    }
    fx *= g.input.repulsion;
    fy *= g.input.repulsion;
    for (const { to, rest } of g.adjacency[i] ?? []) {
      const [qx, qy] = at(to);
      const [dx, dy] = [qx - x, qy - y];
      const d = Math.max(Math.hypot(dx, dy), 1e-6);
      const pull = ((d - Math.fround(rest)) / d) * Math.max(d / Math.fround(rest), 1);
      fx += dx * pull;
      fy += dy * pull;
    }
    let [sx, sy] = [fx * (g.step[i] ?? 0), fy * (g.step[i] ?? 0)];
    const temperature = heat * Math.pow(COLD / heat, 0);
    const moved = Math.hypot(sx, sy);
    if (moved > temperature) {
      sx *= temperature / moved;
      sy *= temperature / moved;
    }
    out.set([x + sx, y + sy], i * 2);
  }
  return out;
}

export async function forceIteration(device: GPUDevice, kernels: Kernels): Promise<void> {
  const g = makeGraph();
  const shared = new Buffers(device);
  const state = shared.storage('state', 4);
  const energy = shared.storage('energy', 4);
  const level = new GpuLevel(kernels, device, g.input, { state, energy }, 1);
  try {
    level.write(g.positions);
    const encoder = device.createCommandEncoder();
    const passes = new Passes(encoder);
    level.encode(passes, 1);
    passes.end();
    device.queue.submit([encoder.finish()]);
    const gpu = new Float32Array(await readBuffer(device, level.latest), 0, g.positions.length);
    const iteration = new Uint32Array(await readBuffer(device, state))[0];
    assert(iteration === 0, `the first iteration counted as ${iteration}`);
    const cpu = cpuIteration(g, level.cell);
    let [error, moved] = [0, 0];
    for (let i = 0; i < gpu.length; i += 2) {
      error += Math.hypot((gpu[i] ?? 0) - (cpu[i] ?? 0), (gpu[i + 1] ?? 0) - (cpu[i + 1] ?? 0));
      moved += Math.hypot((cpu[i] ?? 0) - (g.positions[i] ?? 0), (cpu[i + 1] ?? 0) - (g.positions[i + 1] ?? 0));
    }
    assert(moved > 0, 'nothing moved');
    assert(error <= moved * 1e-3, `GPU differs by ${error.toFixed(3)} over ${moved.toFixed(1)} of movement`);
    for (let i = 3900; i < 4000; i++) {
      assert(gpu[i * 2] === g.positions[i * 2], `frozen node ${i} moved`);
    }
  } finally {
    level.destroy();
    shared.destroy();
  }
}
