import { beginPass, bind, type Buffers, groups, nextPowerOfTwo, type PassTimer } from './gpu';
import type { Kernels } from './kernels';
import { Scan } from './scan';

/** Fine buckets and coarse slots for `count` nodes; powers of two, so masks work. */
export function gridSizes(count: number): { fine: number; coarse: number } {
  const size = nextPowerOfTwo(Math.max(2 * count, 2));
  return { fine: size, coarse: size };
}

/**
 * Spatial hash of one level's nodes, rebuilt every iteration: nodes sorted
 * by fine bucket (`sorted`, ranges in `starts`) and summed per coarse cell
 * (`coarse`). Bound to both position buffers, which the layout swaps.
 */
export class Grid {
  readonly sorted: GPUBuffer;
  /** Bucket counts, then their prefix sum: bucket `b` is `starts[b]..starts[b + 1]`. */
  readonly starts: GPUBuffer;
  readonly coarse: GPUBuffer;
  private readonly cursor: GPUBuffer;
  private readonly scan: Scan;
  private readonly fine: number;
  private readonly slots: number;
  private readonly groups: { bin: GPUBindGroup; scatter: GPUBindGroup }[];
  private readonly sortGroup: GPUBindGroup;

  constructor(
    private readonly kernels: Kernels,
    buffers: Buffers,
    params: GPUBuffer,
    positions: readonly GPUBuffer[],
    nodes: GPUBuffer,
    private readonly count: number,
  ) {
    const sizes = gridSizes(count);
    this.fine = sizes.fine;
    this.slots = sizes.coarse;
    this.starts = buffers.storage('grid starts', (this.fine + 1) * 4);
    this.cursor = buffers.storage('grid cursor', (this.fine + 1) * 4);
    this.sorted = buffers.storage('grid sorted', count * 4);
    this.coarse = buffers.storage('grid coarse', this.slots * 16);
    this.scan = new Scan(kernels, buffers, this.starts, this.fine + 1);
    const device = buffers.device;
    this.groups = positions.map((p) => ({
      bin: bind(device, kernels.bin, { 0: params, 1: p, 2: nodes, 3: this.starts, 4: this.coarse }),
      scatter: bind(device, kernels.scatter, { 0: params, 1: p, 2: nodes, 3: this.cursor, 5: this.sorted }),
    }));
    this.sortGroup = bind(device, kernels.sortBuckets, { 0: params, 5: this.sorted, 6: this.starts });
  }

  /** Bins the nodes at `positions[from]`. */
  encode(encoder: GPUCommandEncoder, from: number, timer?: PassTimer): void {
    const group = this.groups[from];
    if (!group) throw new Error(`no position buffer ${from}`);
    const countBytes = (this.fine + 1) * 4;
    encoder.clearBuffer(this.starts, 0, countBytes);
    encoder.clearBuffer(this.coarse, 0, this.slots * 16);
    const binning = beginPass(encoder, 'bin', timer);
    binning.setPipeline(this.kernels.bin);
    binning.setBindGroup(0, group.bin);
    binning.dispatchWorkgroups(groups(this.count));
    binning.end();
    const scanning = beginPass(encoder, 'scan', timer);
    this.scan.encode(scanning);
    scanning.end();
    encoder.copyBufferToBuffer(this.starts, 0, this.cursor, 0, countBytes);
    const scattering = beginPass(encoder, 'scatter', timer);
    scattering.setPipeline(this.kernels.scatter);
    scattering.setBindGroup(0, group.scatter);
    scattering.dispatchWorkgroups(groups(this.count));
    scattering.end();
    const sorting = beginPass(encoder, 'sort', timer);
    sorting.setPipeline(this.kernels.sortBuckets);
    sorting.setBindGroup(0, this.sortGroup);
    sorting.dispatchWorkgroups(groups(this.fine));
    sorting.end();
  }
}
