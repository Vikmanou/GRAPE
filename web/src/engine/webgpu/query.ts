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

/** Inverse of `ordered` in query.wgsl. */
function unordered(u: number): number {
  const bits = new Uint32Array([u & 0x80000000 ? u ^ 0x80000000 : ~u]);
  return new Float32Array(bits.buffer)[0] ?? 0;
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

  /** The extent of the points of segments whose bit is set, or undefined when none is drawn. */
  async bounds(drawn: Drawn, wanted: Uint32Array<ArrayBuffer>): Promise<WorldBox | undefined> {
    const device = this.device;
    const uniform = device.createBuffer({ size: QUERY_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bits = device.createBuffer({
      size: Math.max(16, Math.ceil(wanted.byteLength / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    const extent = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    try {
      const data = new ArrayBuffer(QUERY_BYTES);
      new Uint32Array(data)[5] = drawn.pieceCount;
      device.queue.writeBuffer(uniform, 0, data);
      if (wanted.byteLength > 0) device.queue.writeBuffer(bits, 0, wanted);
      const encoder = device.createCommandEncoder({ label: 'bounds' });
      encoder.clearBuffer(extent);
      const pass = encoder.beginComputePass({ label: 'bounds' });
      pass.setPipeline(this.kernels.boundPieces);
      pass.setBindGroup(
        0,
        bind(device, this.kernels.boundPieces, { 0: uniform, 1: drawn.positions, 2: drawn.pieces, 4: bits, 5: extent }),
      );
      pass.dispatchWorkgroups(Math.max(1, groups(drawn.pieceCount)));
      pass.end();
      device.queue.submit([encoder.finish()]);
      const [a = 0, b = 0, c = 0, d = 0] = new Uint32Array(await readBuffer(device, extent));
      // Untouched, the minima read back as ~0 and the maxima as 0.
      if (c === 0 && d === 0 && a === 0) return undefined;
      return { minX: unordered(~a >>> 0), minY: unordered(~b >>> 0), maxX: unordered(c), maxY: unordered(d) };
    } finally {
      uniform.destroy();
      bits.destroy();
      extent.destroy();
    }
  }
}
