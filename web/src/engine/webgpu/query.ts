import { bind, groups, readBuffer } from './layout/gpu';
import type { Kernels } from './layout/kernels';
import type { Drawn } from './renderer';

/** Matches `Query` in query.wgsl. */
const QUERY_BYTES = 32;

export interface WorldBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Questions about the drawn ribbons, answered by compute passes with a small readback. */
export class Queries {
  constructor(
    private readonly device: GPUDevice,
    private readonly kernels: Kernels,
  ) {}

  /** One bit per segment whose ribbon, `half` wide, touches `box` (in the positions' frame). */
  async selectBox(drawn: Drawn, box: WorldBox, half: number): Promise<Uint32Array<ArrayBuffer>> {
    const words = Math.ceil(drawn.segments / 32);
    const device = this.device;
    const uniform = device.createBuffer({ size: QUERY_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const hits = device.createBuffer({
      size: Math.max(16, Math.ceil((words * 4) / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    try {
      const data = new ArrayBuffer(QUERY_BYTES);
      new Float32Array(data).set([box.minX, box.minY, box.maxX, box.maxY, half]);
      new Uint32Array(data)[5] = drawn.pieceCount;
      device.queue.writeBuffer(uniform, 0, data);
      const encoder = device.createCommandEncoder({ label: 'select box' });
      encoder.clearBuffer(hits);
      const pass = encoder.beginComputePass({ label: 'select box' });
      pass.setPipeline(this.kernels.selectBox);
      pass.setBindGroup(
        0,
        bind(device, this.kernels.selectBox, { 0: uniform, 1: drawn.positions, 2: drawn.pieces, 3: hits }),
      );
      pass.dispatchWorkgroups(Math.max(1, groups(drawn.pieceCount)));
      pass.end();
      device.queue.submit([encoder.finish()]);
      return new Uint32Array(await readBuffer(device, hits, words * 4));
    } finally {
      uniform.destroy();
      hits.destroy();
    }
  }
}
