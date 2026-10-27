import { bind, Buffers, groups } from './layout/gpu';
import type { Kernels } from './layout/kernels';

/** Matches `Place` in labels.wgsl: 13 words, padded to 16. */
const PLACE_BYTES = 64;

export interface Placement {
  centerX: number;
  centerY: number;
  /** Pixels per world unit. */
  zoom: number;
  width: number;
  height: number;
  /** A label's box per character and per line, in pixels. */
  advance: number;
  lineHeight: number;
  /** Side of a grid cell, in pixels. */
  cell: number;
}

/** What placement reads per segment: the segment table, positions and label sizes. */
export interface LabelSource {
  segments: number;
  positions: GPUBuffer;
  table: GPUBuffer;
}

/**
 * Places labels on the GPU (labels.wgsl) and reads back the segments whose
 * labels won their cells, in no particular order.
 */
export class LabelPlacer {
  private readonly buffers: Buffers;
  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(PLACE_BYTES);
  private grid: { cells: GPUBuffer; winners: GPUBuffer; capacity: number } | undefined;
  private sizes: GPUBuffer | undefined;

  constructor(
    private readonly device: GPUDevice,
    private readonly kernels: Kernels,
  ) {
    this.buffers = new Buffers(device);
    this.uniform = this.buffers.uniform('label placement', this.data);
  }

  /** Per segment, its rank then `chars | lines << 16` (labels.wgsl); undefined drops them. */
  setSizes(sizes: Uint32Array<ArrayBuffer> | undefined): void {
    this.buffers.release(this.sizes);
    this.sizes = sizes && sizes.length > 0 ? this.buffers.upload('label sizes', sizes) : undefined;
  }

  get ready(): boolean {
    return this.sizes !== undefined;
  }

  async place(source: LabelSource, at: Placement): Promise<Uint32Array<ArrayBuffer>> {
    const sizes = this.sizes;
    if (!sizes || source.segments === 0) return new Uint32Array(0);
    const columns = Math.max(1, Math.ceil(at.width / at.cell));
    const rows = Math.max(1, Math.ceil(at.height / at.cell));
    const { cells, winners, capacity } = this.gridFor(columns * rows);
    const f = new Float32Array(this.data);
    f.set([at.centerX, at.centerY, at.zoom, at.zoom, at.width, at.height, at.advance, at.lineHeight, at.cell]);
    new Uint32Array(this.data).set([columns, rows, source.segments, capacity], 9);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);

    const claim = { 0: this.uniform, 1: source.positions, 2: source.table, 3: sizes, 4: cells };
    const encoder = this.device.createCommandEncoder({ label: 'place labels' });
    encoder.clearBuffer(cells, 0, columns * rows * 4);
    encoder.clearBuffer(winners, 0, 4);
    const pass = encoder.beginComputePass({ label: 'place labels' });
    const steps: [GPUComputePipeline, Record<number, GPUBuffer>][] = [
      [this.kernels.claimCells, claim],
      [this.kernels.keepWinners, { ...claim, 5: winners }],
    ];
    for (const [kernel, entries] of steps) {
      pass.setPipeline(kernel);
      pass.setBindGroup(0, bind(this.device, kernel, entries));
      pass.dispatchWorkgroups(groups(source.segments));
    }
    pass.end();
    const staging = this.device.createBuffer({
      label: 'label winners readback',
      size: winners.size,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
    encoder.copyBufferToBuffer(winners, 0, staging, 0, winners.size);
    this.device.queue.submit([encoder.finish()]);
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const words = new Uint32Array(staging.getMappedRange());
      const count = Math.min(words[0] ?? 0, capacity);
      return words.slice(1, 1 + count);
    } finally {
      staging.destroy();
    }
  }

  /** Winners never share a cell, so there are at most as many as cells. */
  private gridFor(cellCount: number): { cells: GPUBuffer; winners: GPUBuffer; capacity: number } {
    if (this.grid && this.grid.capacity >= cellCount) return this.grid;
    this.buffers.release(this.grid?.cells);
    this.buffers.release(this.grid?.winners);
    const capacity = cellCount;
    this.grid = {
      cells: this.buffers.storage('label cells', capacity * 4),
      winners: this.buffers.storage('label winners', (capacity + 1) * 4, GPUBufferUsage.COPY_SRC),
      capacity,
    };
    return this.grid;
  }

  destroy(): void {
    this.buffers.destroy();
  }
}
