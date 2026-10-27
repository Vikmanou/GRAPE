// Box select against a CPU reference that finds each piece's distance to the
// box by ternary search: segments whose ribbon clearly touches or clearly
// misses the box agree; ribbons within a hair of its edge are not judged.

import { Buffers } from '../../src/engine/webgpu/layout/gpu';
import type { Kernels } from '../../src/engine/webgpu/layout/kernels';
import { Queries, type WorldBox } from '../../src/engine/webgpu/query';
import { assert, random } from './reference';

/**
 * Distance between segment `a, b` and the box. Distance to a convex box is
 * convex along the segment, so a ternary search over the segment finds it.
 */
function segmentToBox(box: WorldBox, ax: number, ay: number, bx: number, by: number): number {
  const at = (t: number) => {
    const [x, y] = [ax + t * (bx - ax), ay + t * (by - ay)];
    return Math.hypot(Math.max(box.minX - x, 0, x - box.maxX), Math.max(box.minY - y, 0, y - box.maxY));
  };
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 100; k++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (at(m1) <= at(m2)) hi = m2;
    else lo = m1;
  }
  return Math.min(at(lo), at(0), at(1));
}

export async function boxSelect(device: GPUDevice, kernels: Kernels): Promise<void> {
  const next = random(23);
  const pieceCount = 3000;
  const segments = 1000;
  const positions = Float32Array.from({ length: pieceCount * 4 }, () => next() * 400 - 200);
  const pieces = Uint32Array.from({ length: pieceCount * 2 }, (_, k) => (k % 2 === 0 ? k : Math.floor(k / 6)));
  const half = 2.5;
  const margin = 0.05;
  const queries = new Queries(device, kernels);
  const buffers = new Buffers(device);
  try {
    const drawn = {
      positions: buffers.upload('positions', positions),
      pieces: buffers.upload('pieces', pieces),
      pieceCount,
      segments,
    };
    for (let round = 0; round < 8; round++) {
      const [x0, x1] = [next() * 400 - 200, next() * 400 - 200];
      const [y0, y1] = [next() * 400 - 200, next() * 400 - 200];
      const box = { minX: Math.min(x0, x1), minY: Math.min(y0, y1), maxX: Math.max(x0, x1), maxY: Math.max(y0, y1) };
      const hits = await queries.selectBox(drawn, box, half);
      const inside = new Set<number>();
      const unsure = new Set<number>();
      for (let i = 0; i < pieceCount; i++) {
        const p = (k: number) => positions[i * 4 + k] ?? 0;
        const d = segmentToBox(box, p(0), p(1), p(2), p(3));
        const segment = pieces[i * 2 + 1] ?? 0;
        if (Math.abs(d - half) < margin) unsure.add(segment);
        else if (d < half) inside.add(segment);
      }
      let selected = 0;
      for (let s = 0; s < segments; s++) {
        const got = ((hits[s >>> 5] ?? 0) >>> (s & 31)) & 1;
        selected += got;
        if (inside.has(s)) assert(got === 1, `box ${round}: segment ${s} touches the box but is not selected`);
        else if (!unsure.has(s)) assert(got === 0, `box ${round}: segment ${s} is selected but misses the box`);
      }
      assert(round > 0 || (selected > 0 && selected < segments), `box ${round} selected ${selected}`);
    }
  } finally {
    buffers.destroy();
  }
}

/** The bounds pass against min and max on the CPU, exactly: both read the same f32 points. */
export async function bounds(device: GPUDevice, kernels: Kernels): Promise<void> {
  const next = random(29);
  const pieceCount = 5000;
  const segments = 900;
  const positions = Float32Array.from({ length: pieceCount * 4 }, () => next() * 2e4 - 1e4);
  const pieces = Uint32Array.from({ length: pieceCount * 2 }, (_, k) =>
    k % 2 === 0 ? k : Math.floor(next() * segments),
  );
  const queries = new Queries(device, kernels);
  const buffers = new Buffers(device);
  try {
    const drawn = {
      positions: buffers.upload('positions', positions),
      pieces: buffers.upload('pieces', pieces),
      pieceCount,
      segments,
    };
    const none = await queries.bounds(drawn, new Uint32Array(Math.ceil(segments / 32)));
    assert(none === undefined, 'no wanted segment gives no bounds');
    for (const share of [0.002, 0.05, 1]) {
      const wanted = new Uint32Array(Math.ceil(segments / 32));
      for (let s = 0; s < segments; s++) if (next() < share) wanted[s >>> 5] = (wanted[s >>> 5] ?? 0) | (1 << (s & 31));
      const want = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (let i = 0; i < pieceCount; i++) {
        const s = pieces[i * 2 + 1] ?? 0;
        if ((((wanted[s >>> 5] ?? 0) >>> (s & 31)) & 1) === 0) continue;
        for (let k = 0; k < 2; k++) {
          const [x = 0, y = 0] = [positions[i * 4 + k * 2], positions[i * 4 + k * 2 + 1]];
          want.minX = Math.min(want.minX, x);
          want.minY = Math.min(want.minY, y);
          want.maxX = Math.max(want.maxX, x);
          want.maxY = Math.max(want.maxY, y);
        }
      }
      const got = await queries.bounds(drawn, wanted);
      if (want.minX === Infinity) {
        assert(got === undefined, `share ${share}: bounds without segments`);
        continue;
      }
      assert(
        JSON.stringify(got) === JSON.stringify(want),
        `share ${share}: ${JSON.stringify(got)} vs ${JSON.stringify(want)}`,
      );
    }
  } finally {
    buffers.destroy();
  }
}
