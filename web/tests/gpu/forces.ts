// One force iteration on the GPU against the same maths in f64 on the CPU.

import { Buffers, readBuffer } from '../../src/engine/layout/gpu';
import type { Kernels } from '../../src/engine/layout/kernels';
import { COARSE_PER_CELL, GpuLevel, type LevelInput } from '../../src/engine/layout/level';
import { assert, random } from './reference';

const COLD = 0.4;
const FIXED = 1024;

interface Graph {
  input: LevelInput;
  positions: Float32Array<ArrayBuffer>;
  component: number[];
  step: number[];
  adjacency: { to: number; rest: number }[][];
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
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
  const bits = new Float32Array(1);
  const asBits = (v: number) => {
    bits[0] = v;
    return new Uint32Array(bits.buffer)[0] ?? 0;
  };
  const edges: number[] = [];
  const step: number[] = [];
  let rests = 0;
  for (let i = 0; i < n; i++) {
    const list = adjacency[i] ?? [];
    step.push(Math.fround(1 / (1 + list.length)));
    nodes.set([component[i] ?? 0, asBits(step[i] ?? 0), edges.length / 3, edges.length / 3 + list.length], i * 4);
    for (const { to, rest } of list) {
      edges.push(to, asBits(rest), asBits(1));
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
  const coarse = new Map<string, { count: number; x: number; y: number }>();
  const coarseOf = (i: number) => {
    const [x, y] = at(i);
    const [cx, cy] = [Math.floor(x / coarseCell), Math.floor(y / coarseCell)];
    return {
      cx,
      cy,
      fx: Math.trunc(((x - cx * coarseCell) / coarseCell) * FIXED),
      fy: Math.trunc(((y - cy * coarseCell) / coarseCell) * FIXED),
    };
  };
  for (let i = 0; i < n; i++) {
    const { cx, cy, fx, fy } = coarseOf(i);
    const key = `${g.component[i]},${cx},${cy}`;
    const s = coarse.get(key) ?? { count: 0, x: 0, y: 0 };
    s.count++;
    s.x += fx;
    s.y += fy;
    coarse.set(key, s);
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
    const [hx, hy] = [Math.floor(x / cell), Math.floor(y / cell)];
    for (let j = 0; j < n; j++) {
      if (j === i || g.component[j] !== comp) continue;
      const [qx, qy] = at(j);
      if (Math.abs(Math.floor(qx / cell) - hx) > 1 || Math.abs(Math.floor(qy / cell) - hy) > 1) continue;
      const [dx, dy] = [x - qx, y - qy];
      const d2 = dx * dx + dy * dy;
      const w = 1 - smoothstep(cell / 2, cell, Math.sqrt(d2));
      fx += (dx / d2) * w;
      fy += (dy / d2) * w;
    }
    const own = coarseOf(i);
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const s = coarse.get(`${comp},${own.cx + ox},${own.cy + oy}`);
        if (!s) continue;
        let { count, x: sx, y: sy } = s;
        if (ox === 0 && oy === 0) {
          count -= 1;
          sx -= own.fx;
          sy -= own.fy;
        }
        if (count < 0.5) continue;
        const cx = (own.cx + ox + sx / (count * FIXED)) * coarseCell;
        const cy = (own.cy + oy + sy / (count * FIXED)) * coarseCell;
        const [dx, dy] = [x - cx, y - cy];
        const d2 = Math.max(dx * dx + dy * dy, 1e-4);
        const w = smoothstep(cell / 2, cell, Math.sqrt(d2));
        fx += ((count * dx) / d2) * w;
        fy += ((count * dy) / d2) * w;
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
    level.encode(encoder, 1);
    device.queue.submit([encoder.finish()]);
    const gpu = new Float32Array(await readBuffer(device, level.latest), 0, g.positions.length);
    const iteration = new Uint32Array(await readBuffer(device, state))[0];
    assert(iteration === 1, `state advanced to ${iteration}`);
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
