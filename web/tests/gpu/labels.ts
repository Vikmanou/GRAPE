// Label placement against a CPU run of the same rule, and no two kept labels
// overlap. Anchors and box edges sit inside grid cells, away from their
// borders, so the GPU's and the CPU's floor agree.

import { Buffers } from '../../src/engine/webgpu/layout/gpu';
import type { Kernels } from '../../src/engine/webgpu/layout/kernels';
import { LabelPlacer, type Placement } from '../../src/engine/webgpu/labels';
import { assert, random } from './reference';

export async function labelPlacement(device: GPUDevice, kernels: Kernels): Promise<void> {
  const next = random(21);
  const segments = 4000;
  const at: Placement = {
    centerX: 0,
    centerY: 0,
    zoom: 1,
    width: 800,
    height: 600,
    advance: 8,
    lineHeight: 16,
    cell: 8,
  };
  // Pixels 400, 300 off the world, with some anchors off screen.
  const px = Float64Array.from({ length: segments }, () => Math.floor(next() * 120 - 10) * 8 + 2.5);
  const py = Float64Array.from({ length: segments }, () => Math.floor(next() * 90 - 10) * 8 + 2.5);
  const positions = new Float32Array(segments * 4);
  for (let s = 0; s < segments; s++) {
    const [x, y] = [(px[s] ?? 0) - 400, (py[s] ?? 0) - 300];
    positions.set([x, y, x, y], s * 4);
  }
  const table = new Uint32Array(segments * 8);
  const ranks = Array.from({ length: segments }, (_, i) => i).sort(() => next() - 0.5);
  const chars = Uint32Array.from({ length: segments }, () => (next() < 0.1 ? 0 : 1 + Math.floor(next() * 12)));
  const lines = Uint32Array.from({ length: segments }, () => 1 + Math.floor(next() * 3));
  const sizes = new Uint32Array(segments * 2);
  for (let s = 0; s < segments; s++) {
    table[6 * segments + s] = s * 2;
    table[7 * segments + s] = 1;
    sizes[s] = ranks[s] ?? 0;
    sizes[segments + s] = chars[s] ? ((chars[s] ?? 0) | ((lines[s] ?? 0) << 16)) >>> 0 : 0;
  }

  const box = (s: number) => {
    const [hw, hh] = [((chars[s] ?? 0) * at.advance) / 2, ((lines[s] ?? 0) * at.lineHeight) / 2];
    return { x0: (px[s] ?? 0) - hw, x1: (px[s] ?? 0) + hw, y0: (py[s] ?? 0) - hh, y1: (py[s] ?? 0) + hh };
  };
  const [columns, rows] = [at.width / at.cell, at.height / at.cell];
  const cellsOf = (s: number) => {
    const b = box(s);
    if (!chars[s] || b.x1 < 0 || b.y1 < 0 || b.x0 >= at.width || b.y0 >= at.height) return [];
    const clampTo = (v: number, last: number) => Math.min(last, Math.max(0, Math.floor(v / at.cell)));
    const out: number[] = [];
    for (let y = clampTo(b.y0, rows - 1); y <= clampTo(b.y1, rows - 1); y++) {
      for (let x = clampTo(b.x0, columns - 1); x <= clampTo(b.x1, columns - 1); x++) out.push(y * columns + x);
    }
    return out;
  };
  const owner = new Map<number, number>();
  for (let s = 0; s < segments; s++) {
    for (const c of cellsOf(s)) {
      const o = owner.get(c);
      if (o === undefined || (ranks[s] ?? 0) < (ranks[o] ?? 0)) owner.set(c, s);
    }
  }
  const want: number[] = [];
  for (let s = 0; s < segments; s++) {
    const cells = cellsOf(s);
    if (cells.length > 0 && cells.every((c) => owner.get(c) === s)) want.push(s);
  }

  const buffers = new Buffers(device);
  const placer = new LabelPlacer(device, kernels);
  try {
    placer.setSizes(sizes);
    const source = {
      segments,
      positions: buffers.upload('positions', positions),
      table: buffers.upload('segments', table),
    };
    const got = Array.from(await placer.place(source, at)).sort((a, b) => a - b);
    assert(want.length > 50 && want.length < segments / 2, `${want.length} labels kept; the check needs crowding`);
    assert(got.join() === want.join(), `${got.length} labels kept, expected ${want.length}`);
    for (let i = 0; i < got.length; i++) {
      for (let j = 0; j < i; j++) {
        const [a, b] = [box(got[i] ?? 0), box(got[j] ?? 0)];
        const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
        const onScreen = Math.max(a.x0, b.x0) < at.width && Math.max(a.y0, b.y0) < at.height;
        assert(!(overlap && onScreen), `labels of ${got[i]} and ${got[j]} overlap`);
      }
    }
  } finally {
    placer.destroy();
    buffers.destroy();
  }
}
