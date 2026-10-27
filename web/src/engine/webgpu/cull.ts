import { bind, Buffers, groups } from './layout/gpu';
import type { Kernels } from './layout/kernels';
import { Scan } from './layout/scan';

/** Matches `Cull` in cull.wgsl: 9 words, padded to 12. */
const CULL_BYTES = 48;
const NO_SEGMENT = 0xffffffff;

export type CullKind = 'pieces' | 'links' | 'highlight';

export interface CullView {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
  pad: number;
  ribbonHalf: number;
  /** Highlight only: the hovered segment. */
  hover?: number | undefined;
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
    private readonly kind: CullKind,
    private readonly count: number,
    positions: GPUBuffer,
    items: GPUBuffer,
    indirect: GPUBuffer,
    slot: number,
    /** Highlight only: one bit per selected segment. */
    selected?: GPUBuffer,
  ) {
    const marks = buffers.storage(`${kind} marks`, (count + 1) * 4);
    this.visible = buffers.storage(`visible ${kind}`, count * 4);
    this.uniform = buffers.uniform(`${kind} cull`, this.data);
    new Uint32Array(this.data).set([count, slot], 6);
    this.scan = new Scan(kernels, buffers, marks, count + 1);
    const device = buffers.device;
    const entries: Record<number, GPUBuffer> = {
      0: this.uniform,
      1: positions,
      [kind === 'links' ? 3 : 2]: items,
      4: marks,
    };
    if (selected) entries[7] = selected;
    this.mark = bind(device, this.pipeline(), entries);
    this.compactGroup = bind(device, kernels.compact, { 0: this.uniform, 4: marks, 5: this.visible, 6: indirect });
  }

  private pipeline(): GPUComputePipeline {
    const { markPieces, markLinks, markHighlight } = this.kernels;
    return { pieces: markPieces, links: markLinks, highlight: markHighlight }[this.kind];
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
    new Uint32Array(this.data)[8] = view.hover ?? NO_SEGMENT;
    device.queue.writeBuffer(this.uniform, 0, this.data);
    pass.setPipeline(this.pipeline());
    pass.setBindGroup(0, this.mark);
    pass.dispatchWorkgroups(groups(this.count + 1));
    this.scan.encode(pass);
    pass.setPipeline(this.kernels.compact);
    pass.setBindGroup(0, this.compactGroup);
    pass.dispatchWorkgroups(Math.max(1, groups(this.count)));
  }
}
