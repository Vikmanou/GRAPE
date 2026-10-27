import { bind, Buffers, groups } from './gpu';
import type { Kernels } from './kernels';

/** What pinning reads and writes on level 0 of a running layout. */
export interface LevelZero {
  positions: GPUBuffer;
  nodes: GPUBuffer;
  /** The level's nodes as the hierarchy gave them. */
  original: GPUBuffer;
}

/** The drawn ribbons: which points belong to which segment, and the selection. */
export interface Ribbons {
  pieces: GPUBuffer;
  pieceCount: number;
  selected: GPUBuffer;
}

/** Segments the user dragged, which the layout no longer moves. */
export class Pins {
  private readonly buffers: Buffers;
  private readonly bits: Uint32Array<ArrayBuffer>;
  private readonly pinned: GPUBuffer;
  private readonly moveUniform: GPUBuffer;
  private readonly mobilityUniform: GPUBuffer;
  private size = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly kernels: Kernels,
    segments: number,
    private readonly starts: Uint32Array,
    private readonly pieces: Uint8Array,
  ) {
    const b = (this.buffers = new Buffers(device));
    this.bits = new Uint32Array(Math.ceil(segments / 32));
    this.pinned = b.storage('pinned segments', this.bits.byteLength);
    this.moveUniform = b.uniform('move', new ArrayBuffer(16));
    this.mobilityUniform = b.uniform('mobility', new ArrayBuffer(16));
  }

  get count(): number {
    return this.size;
  }

  /** Moves a segment's points by `dx, dy` and pins it. Its step size changes with the next `apply`. */
  drag(level: LevelZero, segment: number, dx: number, dy: number): void {
    const first = this.starts[segment];
    const pieces = this.pieces[segment];
    if (first === undefined || pieces === undefined) return;
    const word = segment >>> 5;
    const bit = 1 << (segment & 31);
    if (!((this.bits[word] ?? 0) & bit)) {
      this.bits[word] = (this.bits[word] ?? 0) | bit;
      this.size++;
      this.device.queue.writeBuffer(this.pinned, word * 4, this.bits, word, 1);
    }
    const data = new ArrayBuffer(16);
    new Uint32Array(data).set([first, pieces + 1]);
    new Float32Array(data).set([dx, dy], 2);
    this.device.queue.writeBuffer(this.moveUniform, 0, data);
    this.dispatch(this.kernels.translate, { 0: this.moveUniform, 1: level.positions }, pieces + 1);
  }

  clear(): void {
    this.bits.fill(0);
    this.size = 0;
    this.device.queue.writeBuffer(this.pinned, 0, this.bits);
  }

  /** Sets which points may move: all but the pinned, or only the selected among them. */
  apply(level: LevelZero, ribbons: Ribbons, onlySelected: boolean): void {
    this.device.queue.writeBuffer(this.mobilityUniform, 0, new Uint32Array([ribbons.pieceCount, onlySelected ? 1 : 0]));
    this.dispatch(
      this.kernels.setMobility,
      {
        2: this.mobilityUniform,
        3: ribbons.pieces,
        4: level.original,
        5: level.nodes,
        6: this.pinned,
        7: ribbons.selected,
      },
      ribbons.pieceCount,
    );
  }

  destroy(): void {
    this.buffers.destroy();
  }

  private dispatch(pipeline: GPUComputePipeline, buffers: Record<number, GPUBuffer>, count: number): void {
    const encoder = this.device.createCommandEncoder({ label: pipeline.label });
    const pass = encoder.beginComputePass({ label: pipeline.label });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind(this.device, pipeline, buffers));
    pass.dispatchWorkgroups(Math.max(1, groups(count)));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }
}
