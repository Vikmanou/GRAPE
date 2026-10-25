import type { HierarchyLevel } from '../../workers/protocol';
import { bind, Buffers, groups } from './gpu';
import { Grid, gridSizes } from './grid';
import type { Kernels } from './kernels';
import { encodeParams } from './params';

/** Fine cells span this many mean rest lengths; coarse cells this many fine cells. */
export const CELL_PER_REST = 2;
export const COARSE_PER_CELL = 4;

/** Buffers every level shares. */
export interface Shared {
  /** Iteration within the level. */
  state: GPUBuffer;
  /** Total displacement of the last iteration, in sixteenths. */
  energy: GPUBuffer;
}

export type LevelInput = Pick<HierarchyLevel, 'nodes' | 'edges' | 'heat' | 'repulsion' | 'meanRest' | 'iterations'>;

/** One level's buffers and its force iteration, ping-ponging between two position buffers. */
export class GpuLevel {
  readonly count: number;
  readonly nodes: GPUBuffer;
  readonly params: GPUBuffer;
  readonly cell: number;
  private readonly buffers: Buffers;
  private readonly positions: [GPUBuffer, GPUBuffer];
  private readonly grid: Grid;
  private readonly repelGroups: GPUBindGroup[];
  private readonly moveGroups: GPUBindGroup[];
  private readonly advanceGroup: GPUBindGroup;
  private current = 0;

  constructor(
    private readonly kernels: Kernels,
    device: GPUDevice,
    input: LevelInput,
    private readonly shared: Shared,
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
    const edges = b.upload('edges', input.edges);
    const heat = b.upload('heat', input.heat);
    const force = b.storage('force', this.count * 8);
    this.positions = [b.storage('positions a', this.count * 8), b.storage('positions b', this.count * 8)];
    this.grid = new Grid(kernels, b, this.params, this.positions, this.nodes, this.count);
    this.repelGroups = this.positions.map((p) =>
      bind(device, kernels.repel, {
        0: this.params,
        1: p,
        2: this.nodes,
        4: this.grid.coarse,
        5: this.grid.sorted,
        6: this.grid.starts,
        7: force,
        9: heat,
      }),
    );
    this.moveGroups = this.positions.map((p, k) =>
      bind(device, kernels.pullAndMove, {
        0: this.params,
        1: p,
        2: this.nodes,
        3: edges,
        7: force,
        8: this.positions[1 - k] ?? p,
        9: heat,
        10: shared.state,
        11: shared.energy,
      }),
    );
    this.advanceGroup = bind(device, kernels.advance, { 10: shared.state });
  }

  /** The buffer holding the latest positions, `x, y` per node. */
  get latest(): GPUBuffer {
    return this.positions[this.current === 0 ? 0 : 1];
  }

  /** `x, y` per node, replacing the latest positions. */
  write(positions: Float32Array<ArrayBuffer>): void {
    this.buffers.device.queue.writeBuffer(this.latest, 0, positions);
  }

  get bytes(): number {
    return this.buffers.bytes;
  }

  encode(encoder: GPUCommandEncoder, iterations: number): void {
    const n = groups(this.count);
    for (let k = 0; k < iterations; k++) {
      encoder.clearBuffer(this.shared.energy);
      this.grid.encode(encoder, this.current);
      const pass = encoder.beginComputePass({ label: 'forces' });
      pass.setPipeline(this.kernels.repel);
      pass.setBindGroup(0, this.repelGroups[this.current]);
      pass.dispatchWorkgroups(n);
      pass.setPipeline(this.kernels.pullAndMove);
      pass.setBindGroup(0, this.moveGroups[this.current]);
      pass.dispatchWorkgroups(n);
      pass.setPipeline(this.kernels.advance);
      pass.setBindGroup(0, this.advanceGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      this.current = 1 - this.current;
    }
  }

  destroy(): void {
    this.buffers.destroy();
  }
}
