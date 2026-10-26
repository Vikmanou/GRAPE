// The cull pass against the same test on the CPU: the same items, in order.

import { Cull, type CullView } from '../../src/engine/cull';
import { Buffers, readBuffer } from '../../src/engine/layout/gpu';
import type { Kernels } from '../../src/engine/layout/kernels';
import { assert, random } from './reference';

export async function culling(device: GPUDevice, kernels: Kernels): Promise<void> {
  const next = random(9);
  const points = 20_000;
  const positions = Float32Array.from({ length: points * 2 }, () => next() * 2000 - 1000);
  const pieces = Uint32Array.from({ length: (points / 2) * 2 }, (_, k) => (k % 2 === 0 ? k : k >> 1));
  const links = Uint32Array.from({ length: 5000 * 4 }, () => Math.floor(next() * points));
  // Fractions of a unit keep every box well away from the view's edges.
  const view: CullView = {
    centerX: 100.25,
    centerY: -50.25,
    halfWidth: 300.5,
    halfHeight: 200.5,
    pad: 3.125,
    ribbonHalf: 2.5,
  };
  const buffers = new Buffers(device);
  try {
    const at = buffers.upload('positions', positions);
    const indirect = buffers.upload('indirect', new Uint32Array(8), GPUBufferUsage.INDIRECT);
    const pieceCull = new Cull(
      kernels,
      buffers,
      'pieces',
      pieces.length / 2,
      at,
      buffers.upload('pieces', pieces),
      indirect,
      5,
    );
    const linkCull = new Cull(
      kernels,
      buffers,
      'links',
      links.length / 4,
      at,
      buffers.upload('links', links),
      indirect,
      1,
    );
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pieceCull.encode(device, pass, view);
    linkCull.encode(device, pass, view);
    pass.end();
    device.queue.submit([encoder.finish()]);
    const counts = new Uint32Array(await readBuffer(device, indirect));
    const point = (i: number) => [positions[i * 2] ?? 0, positions[i * 2 + 1] ?? 0] as const;
    const touches = (lo: readonly number[], hi: readonly number[]) =>
      (hi[0] ?? 0) >= view.centerX - view.halfWidth &&
      (lo[0] ?? 0) <= view.centerX + view.halfWidth &&
      (hi[1] ?? 0) >= view.centerY - view.halfHeight &&
      (lo[1] ?? 0) <= view.centerY + view.halfHeight;
    const box = (a: readonly number[], b: readonly number[], pad: number) => [
      [Math.min(a[0] ?? 0, b[0] ?? 0) - pad, Math.min(a[1] ?? 0, b[1] ?? 0) - pad],
      [Math.max(a[0] ?? 0, b[0] ?? 0) + pad, Math.max(a[1] ?? 0, b[1] ?? 0) + pad],
    ];
    const wantPieces: number[] = [];
    for (let i = 0; i < pieces.length / 2; i++) {
      const first = pieces[i * 2] ?? 0;
      const [lo = [], hi = []] = box(point(first), point(first + 1), view.pad);
      if (touches(lo, hi)) wantPieces.push(i);
    }
    const wantLinks: number[] = [];
    for (let i = 0; i < links.length / 4; i++) {
      const [a, b] = [point(links[i * 4] ?? 0), point(links[i * 4 + 2] ?? 0)];
      const reach = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.4, view.ribbonHalf * 6) * 1.5 + view.pad;
      const [lo = [], hi = []] = box(a, b, reach);
      if (touches(lo, hi)) wantLinks.push(i);
    }
    const gotPieces = Array.from(new Uint32Array(await readBuffer(device, pieceCull.visible)).subarray(0, counts[5]));
    const gotLinks = Array.from(new Uint32Array(await readBuffer(device, linkCull.visible)).subarray(0, counts[1]));
    assert(wantPieces.length > 0 && wantPieces.length < pieces.length / 2, 'the view should hold some pieces, not all');
    assert(gotPieces.join() === wantPieces.join(), `pieces: ${gotPieces.length} kept, expected ${wantPieces.length}`);
    assert(gotLinks.join() === wantLinks.join(), `links: ${gotLinks.length} kept, expected ${wantLinks.length}`);
  } finally {
    buffers.destroy();
  }
}
