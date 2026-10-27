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

export type LevelInput = Pick<HierarchyLevel, 'nodes' | 'edges' | 'heat' | 'repulsion' | 'meanRest' | 'iterations'>;

/** One level's buffers and its force iteration, ping-ponging between two position buffers. */
export class GpuLevel {
  readonly count: number;
  readonly nodes: GPUBuffer;
  readonly edges: GPUBuffer;
  readonly params: GPUBuffer;
  readonly cell: number;
  private readonly buffers: Buffers;
  private readonly positions: [GPUBuffer, GPUBuffer];
  private readonly grid: Grid;
  private readonly repelGroup: GPUBindGroup;
  private readonly moveGroups: GPUBindGroup[];

  private current = 0;
  private readonly state: GPUBuffer;

  constructor(
    private readonly kernels: Kernels,
    device: GPUDevice,
    input: LevelInput,
    shared: IterationState,
    seed: number,
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
      }),
    );
    this.nodes = b.upload('nodes', input.nodes);
    this.edges = b.upload('edges', input.edges);
    const heat = b.upload('heat', input.heat);
    const force = b.storage('force', this.count * 8);
    this.positions = [b.storage('positions a', this.count * 8), b.storage('positions b', this.count * 8)];
    this.grid = new Grid(kernels, b, this.params, this.positions, this.nodes, this.count, shared);
    this.repelGroup = bind(device, kernels.repel, {
      0: this.params,
      4: this.grid.coarse,
      6: this.grid.starts,
      7: force,
      9: heat,
      12: this.grid.packed,
    });
    this.moveGroups = this.positions.map((p, k) =>
      bind(device, kernels.pullAndMove, {
        0: this.params,
        1: p,
        2: this.nodes,
        3: this.edges,
        7: force,
        8: this.positions[1 - k] ?? p,
        9: heat,
        10: shared.state,
        11: shared.energy,
      }),
    );
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
    const n = groups(this.count);
    for (let k = 0; k < iterations; k++) {
      this.grid.encode(passes, this.current);
      const repelling = passes.section('repel');
      repelling.setPipeline(this.kernels.repel);
      repelling.setBindGroup(0, this.repelGroup);
      repelling.dispatchWorkgroups(n);
      const moving = passes.section('move');
      moving.setPipeline(this.kernels.pullAndMove);
      moving.setBindGroup(0, this.moveGroups[this.current]);
      moving.dispatchWorkgroups(n);
      this.current = 1 - this.current;
    }
  }

  destroy(): void {
    this.buffers.destroy();
  }
}
