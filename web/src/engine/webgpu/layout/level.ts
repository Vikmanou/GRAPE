import type { HierarchyLevel } from '../../../workers/protocol/layout';
import { bind, Buffers, groups, type Passes } from './gpu';
import { Grid, gridSizes, type IterationState } from './grid';
import type { Kernels } from './kernels';
import { encodeParams } from './params';

/** Fine cells span this many mean rest lengths; coarse cells this many fine cells. */
const CELL_PER_REST = 2;
export const COARSE_PER_CELL = 3;
/** Coarse cells read on each side of a node's own; `FAR_REACH` in forces.wgsl. */
export const FAR_REACH = 2;
/** Cells per next-tier cell on a side, from coarse to tier 1 and on; `TAIL_PER_COARSE` in layout-common.wgsl. */
export const TAIL_PER_COARSE = 3;
/** Far tiers beyond the coarse cells; `TAIL_TIERS` in layout-common.wgsl. */
export const TAIL_TIERS = 3;
/** Far cells read on each side of a node's own, in each tier; `TAIL_REACH` in forces.wgsl. */
export const TAIL_REACH = 2;
/**
 * Levels this small repel every pair in one pass: cheaper than the seven
 * passes of the grid, whose cost on small levels is mostly fixed.
 */
export const ALL_PAIRS_NODES = 2048;

export type LevelInput = Pick<HierarchyLevel, 'nodes' | 'edges' | 'heat' | 'repulsion' | 'meanRest' | 'iterations'>;

/** What only iterating needs; rebuilt on demand, so a settled level can give it back. */
interface Scratch {
  buffers: Buffers;
  grid: Grid;
  repelGroups: GPUBindGroup[];
  moveGroups: GPUBindGroup[];
}

/** One level's buffers and its force iteration, ping-ponging between two position buffers. */
export class GpuLevel {
  readonly count: number;
  readonly nodes: GPUBuffer;
  readonly edges: GPUBuffer;
  readonly params: GPUBuffer;
  readonly cell: number;
  private readonly buffers: Buffers;
  private readonly positions: [GPUBuffer, GPUBuffer];
  private readonly heat: GPUBuffer;
  private readonly allPairs: boolean;
  private scratch: Scratch | undefined;

  private current = 0;
  private readonly state: GPUBuffer;

  constructor(
    private readonly kernels: Kernels,
    private readonly device: GPUDevice,
    input: LevelInput,
    private readonly shared: IterationState,
    seed: number,
    allPairsUpTo = ALL_PAIRS_NODES,
  ) {
    this.buffers = new Buffers(device);
    const b = this.buffers;
    this.count = input.nodes.length / 4;
    this.cell = Math.max(input.meanRest * CELL_PER_REST, 1);
    const sizes = gridSizes(this.count);
    this.params = b.uniform(
      'level params',
      encodeParams({
        count: this.count,
        fineMask: sizes.fine - 1,
        coarseMask: sizes.coarse - 1,
        seed,
        cell: this.cell,
        coarseCell: this.cell * COARSE_PER_CELL,
        repulsion: input.repulsion,
        iterations: input.iterations,
        tailMask: sizes.tail - 1,
      }),
    );
    this.nodes = b.upload('nodes', input.nodes);
    this.edges = b.upload('edges', input.edges);
    this.heat = b.upload('heat', input.heat);
    this.positions = [b.storage('positions a', this.count * 8), b.storage('positions b', this.count * 8)];
    this.allPairs = this.count <= allPairsUpTo;
    this.state = shared.state;
    this.restart();
  }

  /** Runs the level's cooling schedule again from iteration `from`. */
  restart(from = 0): void {
    // The next iteration's `begin` adds one, wrapping 0xffffffff to 0.
    this.buffers.device.queue.writeBuffer(this.state, 0, new Uint32Array([(from - 1) >>> 0]));
  }

  /** The buffer holding the latest positions, `x, y` per node. */
  get latest(): GPUBuffer {
    return this.positions[this.current === 0 ? 0 : 1];
  }

  /** `x, y` per node, replacing the latest positions. */
  write(positions: Float32Array<ArrayBuffer>): void {
    this.buffers.device.queue.writeBuffer(this.latest, 0, positions);
  }

  encode(passes: Passes, iterations: number): void {
    const { grid, repelGroups, moveGroups } = this.iterating();
    const n = groups(this.count);
    for (let k = 0; k < iterations; k++) {
      if (this.allPairs) grid.begin(passes, this.current);
      else grid.encode(passes, this.current);
      const repelling = passes.section('repel');
      repelling.setPipeline(this.allPairs ? this.kernels.repelAll : this.kernels.repel);
      repelling.setBindGroup(0, repelGroups[this.current]);
      repelling.dispatchWorkgroups(n);
      const moving = passes.section('move');
      moving.setPipeline(this.kernels.pullAndMove);
      moving.setBindGroup(0, moveGroups[this.current]);
      moving.dispatchWorkgroups(n);
      this.current = 1 - this.current;
    }
  }

  /** Gives back the forces and the grid, which a settled level does not use; the next `encode` makes them again. */
  release(): void {
    this.scratch?.buffers.destroy();
    this.scratch = undefined;
  }

  destroy(): void {
    this.release();
    this.buffers.destroy();
  }

  private iterating(): Scratch {
    if (this.scratch) return this.scratch;
    const { device, kernels, heat, nodes, edges, params, positions, shared } = this;
    const buffers = new Buffers(device);
    const force = buffers.storage('force', this.count * 8);
    const grid = new Grid(kernels, buffers, params, positions, nodes, this.count, shared);
    const repelGroups = positions.map((p) =>
      this.allPairs
        ? bind(device, kernels.repelAll, { 0: params, 1: p, 2: nodes, 7: force, 9: heat })
        : bind(device, kernels.repel, {
            0: params,
            4: grid.coarse,
            6: grid.starts,
            7: force,
            9: heat,
            12: grid.packed,
            13: grid.tail,
          }),
    );
    const moveGroups = positions.map((p, k) =>
      bind(device, kernels.pullAndMove, {
        0: params,
        1: p,
        2: nodes,
        3: edges,
        7: force,
        8: positions[1 - k] ?? p,
        9: heat,
        10: shared.state,
        11: shared.energy,
      }),
    );
    this.scratch = { buffers, grid, repelGroups, moveGroups };
    return this.scratch;
  }
}
