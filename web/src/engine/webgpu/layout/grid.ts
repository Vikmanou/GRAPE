import { bind, type Buffers, groups, MAX_GROUPS, nextPowerOfTwo, type Passes } from './gpu';
import type { Kernels } from './kernels';
import { Scan } from './scan';

/** Fine buckets and coarse slots for `count` nodes; powers of two, so masks work. */
export function gridSizes(count: number): { fine: number; coarse: number } {
  const size = nextPowerOfTwo(Math.max(2 * count, 2));
  return { fine: size, coarse: size };
}

/** Buffers the iteration's first kernel resets. */
export interface IterationState {
  /** Iteration within the level. */
  state: GPUBuffer;
  /** Total displacement of the iteration, in sixteenths. */
  energy: GPUBuffer;
}

/**
 * Spatial hash of one level's nodes, rebuilt every iteration: nodes sorted
 * by fine bucket (`sorted` and `packed`, ranges in `starts`) and summed per
 * coarse cell (`coarse`). Bound to both position buffers, which the layout
 * swaps.
 */
export class Grid {
  readonly sorted: GPUBuffer;
  /** Bucket counts, then their prefix sum: bucket `b` is `starts[b]..starts[b + 1]`. */
  readonly starts: GPUBuffer;
  readonly coarse: GPUBuffer;
  /** `x bits, y bits, component, node` per node, in bucket order. */
  readonly packed: GPUBuffer;
  private readonly scan: Scan;
  private readonly fine: number;
  private readonly beginGroups: number;
  private readonly groups: { begin: GPUBindGroup; bin: GPUBindGroup; scatter: GPUBindGroup; sort: GPUBindGroup }[];

  constructor(
    private readonly kernels: Kernels,
    buffers: Buffers,
    params: GPUBuffer,
    positions: readonly GPUBuffer[],
    nodes: GPUBuffer,
    private readonly count: number,
    iteration: IterationState,
  ) {
    const sizes = gridSizes(count);
    this.fine = sizes.fine;
    this.starts = buffers.storage('grid starts', (this.fine + 1) * 4);
    const cursor = buffers.storage('grid cursor', (this.fine + 1) * 4);
    this.sorted = buffers.storage('grid sorted', count * 4);
    this.coarse = buffers.storage('grid coarse', sizes.coarse * 16);
    this.packed = buffers.storage('grid packed', count * 16);
    this.scan = new Scan(kernels, buffers, this.starts, this.fine + 1, cursor);
    this.beginGroups = Math.min(MAX_GROUPS, groups(Math.max(this.fine + 1, sizes.coarse * 4)));
    const device = buffers.device;
    this.groups = positions.map((p) => ({
      begin: bind(device, kernels.begin, {
        0: params,
        3: this.starts,
        4: this.coarse,
        8: iteration.state,
        9: iteration.energy,
      }),
      bin: bind(device, kernels.bin, { 0: params, 1: p, 2: nodes, 3: this.starts, 4: this.coarse }),
      scatter: bind(device, kernels.scatter, { 0: params, 1: p, 2: nodes, 3: cursor, 5: this.sorted }),
      sort: bind(device, kernels.sortBuckets, {
        0: params,
        1: p,
        2: nodes,
        5: this.sorted,
        6: this.starts,
        7: this.packed,
      }),
    }));
  }

  /** Starts an iteration: advances it and clears the energy and the tables. */
  begin(passes: Passes, from: number): void {
    const starting = passes.section('begin');
    starting.setPipeline(this.kernels.begin);
    starting.setBindGroup(0, this.group(from).begin);
    starting.dispatchWorkgroups(this.beginGroups);
  }

  /** Starts an iteration and bins the nodes at `positions[from]`. */
  encode(passes: Passes, from: number): void {
    this.begin(passes, from);
    const group = this.group(from);
    const binning = passes.section('bin');
    binning.setPipeline(this.kernels.bin);
    binning.setBindGroup(0, group.bin);
    binning.dispatchWorkgroups(groups(this.count));
    this.scan.encode(passes.section('scan'));
    const scattering = passes.section('scatter');
    scattering.setPipeline(this.kernels.scatter);
    scattering.setBindGroup(0, group.scatter);
    scattering.dispatchWorkgroups(groups(this.count));
    const sorting = passes.section('sort');
    sorting.setPipeline(this.kernels.sortBuckets);
    sorting.setBindGroup(0, group.sort);
    sorting.dispatchWorkgroups(groups(this.fine));
  }

  private group(from: number) {
    const group = this.groups[from];
    if (!group) throw new Error(`no position buffer ${from}`);
    return group;
  }
}
