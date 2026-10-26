import { bind, Buffers, groups } from './layout/gpu';
import type { Kernels } from './layout/kernels';
import { Scan } from './layout/scan';

/** Matches `Cull` in cull.wgsl: 8 words. */
const CULL_BYTES = 32;

export interface CullView {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  pad: number;
  ribbonHalf: number;
}

/**
 * Finds the ribbon pieces or links that touch the view, in their own order,
 * and writes their count into the draw's indirect arguments.
 */
export class Cull {
  /** Indices of the items that touch the view. */
  readonly visible: GPUBuffer;
  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(CULL_BYTES);
  private readonly scan: Scan;
  private readonly mark: GPUBindGroup;
  private readonly compactGroup: GPUBindGroup;

  constructor(
    private readonly kernels: Kernels,
    buffers: Buffers,
    private readonly kind: 'pieces' | 'links',
    private readonly count: number,
    positions: GPUBuffer,
    items: GPUBuffer,
    indirect: GPUBuffer,
    slot: number,
  ) {
    const marks = buffers.storage(`${kind} marks`, (count + 1) * 4);
    this.visible = buffers.storage(`visible ${kind}`, count * 4);
    this.uniform = buffers.uniform(`${kind} cull`, this.data);
    new Uint32Array(this.data).set([count, slot], 6);
    this.scan = new Scan(kernels, buffers, marks, count + 1);
    const device = buffers.device;
    const pipeline = kind === 'pieces' ? kernels.markPieces : kernels.markLinks;
    this.mark = bind(device, pipeline, { 0: this.uniform, 1: positions, [kind === 'pieces' ? 2 : 3]: items, 4: marks });
    this.compactGroup = bind(device, kernels.compact, { 0: this.uniform, 4: marks, 5: this.visible, 6: indirect });
  }

  encode(device: GPUDevice, pass: GPUComputePassEncoder, view: CullView): void {
    new Float32Array(this.data).set([
      view.centerX,
      view.centerY,
      view.halfWidth,
      view.halfHeight,
      view.pad,
      view.ribbonHalf,
    ]);
    device.queue.writeBuffer(this.uniform, 0, this.data);
    pass.setPipeline(this.kind === 'pieces' ? this.kernels.markPieces : this.kernels.markLinks);
    pass.setBindGroup(0, this.mark);
    pass.dispatchWorkgroups(groups(this.count + 1));
    this.scan.encode(pass);
    pass.setPipeline(this.kernels.compact);
    pass.setBindGroup(0, this.compactGroup);
    pass.dispatchWorkgroups(Math.max(1, groups(this.count)));
  }
}
