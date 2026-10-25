import { bind, type Buffers } from './gpu';
import type { Kernels } from './kernels';

const BLOCK = 512;

interface Round {
  blocks: number;
  scan: GPUBindGroup;
  add: GPUBindGroup;
}

/**
 * In-place exclusive prefix sum over the first `length` u32s of a buffer.
 * Each round scans blocks and leaves block totals for the next round; the
 * totals are then added back from the top round down.
 */
export class Scan {
  private readonly rounds: Round[] = [];

  constructor(
    private readonly kernels: Kernels,
    buffers: Buffers,
    data: GPUBuffer,
    length: number,
  ) {
    let current = data;
    let n = length;
    for (;;) {
      const blocks = Math.ceil(n / BLOCK);
      const sums = buffers.storage('scan sums', blocks * 4);
      const size = buffers.uniform('scan length', new Uint32Array([n, 0, 0, 0]).buffer);
      const entries = { 0: current, 1: sums, 2: size };
      this.rounds.push({
        blocks,
        scan: bind(buffers.device, kernels.scanBlocks, entries),
        add: bind(buffers.device, kernels.addSums, entries),
      });
      if (blocks <= 1) break;
      current = sums;
      n = blocks;
    }
  }

  encode(pass: GPUComputePassEncoder): void {
    pass.setPipeline(this.kernels.scanBlocks);
    for (const round of this.rounds) {
      pass.setBindGroup(0, round.scan);
      pass.dispatchWorkgroups(round.blocks);
    }
    pass.setPipeline(this.kernels.addSums);
    for (const round of this.rounds.slice(0, -1).reverse()) {
      pass.setBindGroup(0, round.add);
      pass.dispatchWorkgroups(round.blocks);
    }
  }
}
