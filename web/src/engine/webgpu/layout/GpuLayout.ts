import type { Hierarchy } from '../../../workers/protocol/layout';
import { bind, Buffers, groups, Passes, type PassTiming, readBuffer } from './gpu';
import type { Kernels } from './kernels';
import { GpuLevel } from './level';

export interface Measured {
  /** `x0, y0, x1, y1` per component, before packing. */
  boxes: Float32Array<ArrayBuffer>;
  /** Mean displacement in the last iteration. */
  energy: number;
}

function levelSeed(seed: number, level: number): number {
  return (seed ^ Math.imul(level + 1, 0x9e3779b1)) >>> 0;
}

/** Inverse of `ordered` in present.wgsl. */
function unordered(u: number): number {
  const bits = new Uint32Array([u & 0x80000000 ? u ^ 0x80000000 : ~u]);
  return new Float32Array(bits.buffer)[0] ?? 0;
}

/**
 * The multilevel layout on the GPU, as the CPU reference (gfa-core
 * layout/mod.rs) runs it: the coarsest level from its seeded start, then
 * each finer level from its parent's positions. Only the running level's
 * buffers exist at a time.
 */
export class GpuLayout {
  readonly total: number;
  private iterationCount = 0;
  private level: GpuLevel;
  private levelIndex: number;
  private levelIteration = 0;
  private readonly shared: Buffers;
  private readonly state: GPUBuffer;
  private readonly energy: GPUBuffer;
  private readonly walk: GPUBuffer;
  private readonly parents: GPUBuffer;
  private readonly sizes: GPUBuffer;
  private readonly ancestors: GPUBuffer;
  private readonly points: GPUBuffer;
  private readonly shift: GPUBuffer;
  private readonly boxes: GPUBuffer;
  readonly components: number;
  private readonly pointCount: number;

  constructor(
    private readonly device: GPUDevice,
    private readonly kernels: Kernels,
    private readonly hierarchy: Hierarchy,
    private readonly seed: number,
  ) {
    const levels = hierarchy.levels;
    const top = levels.length - 1;
    const first = levels[0];
    const coarsest = levels[top];
    if (!first || !coarsest) throw new Error('the hierarchy has no levels');
    this.total = levels.reduce((sum, l) => sum + l.iterations, 0);
    this.pointCount = first.nodes.length / 4;
    this.components = hierarchy.frozen.length;
    const b = (this.shared = new Buffers(device));
    this.state = b.storage('layout state', 4);
    this.energy = b.storage('layout energy', 4);
    this.walk = b.uniform('walk', new Uint32Array([this.pointCount, top, 0, 0]).buffer);
    const parents = new Uint32Array(levels.slice(0, top).reduce((n, l) => n + l.parent.length, 0));
    let offset = 0;
    for (const l of levels.slice(0, top)) {
      parents.set(l.parent, offset);
      offset += l.parent.length;
    }
    this.parents = b.upload('parents', parents);
    this.sizes = b.upload(
      'level sizes',
      Uint32Array.from(levels, (l) => l.nodes.length / 4),
    );
    this.ancestors = b.storage('ancestors', this.pointCount * 4);
    this.points = b.upload('points', first.nodes);
    this.shift = b.storage('component shift', this.components * 8);
    this.boxes = b.storage('component boxes', this.components * 16);

    this.levelIndex = top;
    this.level = this.createLevel(top);
    this.level.write(hierarchy.start);
    const encoder = device.createCommandEncoder({ label: 'layout start' });
    this.encodeAncestors(encoder);
    device.queue.submit([encoder.finish()]);
  }

  get iteration(): number {
    return this.iterationCount;
  }

  get currentLevel(): number {
    return this.levelIndex;
  }

  get levelNodes(): number {
    return this.level.count;
  }

  get levels(): number {
    return this.hierarchy.levels.length;
  }

  get done(): boolean {
    return this.levelIndex === 0 && this.levelIteration >= this.budget(0);
  }

  /** Submits up to `n` iterations, stopping at the end of a level. Returns how many ran. */
  run(n: number, timing?: PassTiming): number {
    if (this.done) return 0;
    if (this.levelIteration >= this.budget(this.levelIndex)) this.descend();
    const k = Math.min(n, this.budget(this.levelIndex) - this.levelIteration);
    const encoder = this.device.createCommandEncoder({ label: 'layout iterations' });
    const passes = new Passes(encoder, undefined, timing?.writes);
    this.level.encode(passes, k);
    passes.end();
    timing?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    this.levelIteration += k;
    this.iterationCount += k;
    return k;
  }

  /** Writes every point's drawn position, `shift` (`dx, dy` per component) added, into `target`. */
  present(target: GPUBuffer, shift: Float32Array<ArrayBuffer>): void {
    this.device.queue.writeBuffer(this.shift, 0, shift);
    const group = bind(this.device, this.kernels.present, {
      0: this.walk,
      3: this.ancestors,
      4: this.level.latest,
      5: this.points,
      6: this.shift,
      7: target,
    });
    const encoder = this.device.createCommandEncoder({ label: 'present' });
    const pass = encoder.beginComputePass({ label: 'present' });
    pass.setPipeline(this.kernels.present);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(groups(this.pointCount));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
  }

  /** Every point's position with `shift` added, read back from the GPU. */
  async readPositions(shift: Float32Array<ArrayBuffer>): Promise<Float32Array<ArrayBuffer>> {
    const target = this.shared.storage('positions readback', this.pointCount * 8);
    try {
      this.present(target, shift);
      return new Float32Array(await readBuffer(this.device, target, this.pointCount * 8));
    } finally {
      target.destroy();
    }
  }

  async measure(): Promise<Measured> {
    const encoder = this.device.createCommandEncoder({ label: 'measure' });
    encoder.clearBuffer(this.boxes);
    const pass = encoder.beginComputePass({ label: 'bound' });
    pass.setPipeline(this.kernels.bound);
    pass.setBindGroup(
      0,
      bind(this.device, this.kernels.bound, {
        4: this.level.latest,
        8: this.level.params,
        9: this.level.nodes,
        10: this.boxes,
      }),
    );
    pass.dispatchWorkgroups(groups(this.level.count));
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const count = this.level.count;
    const [raw, energy] = await Promise.all([
      readBuffer(this.device, this.boxes, this.components * 16),
      readBuffer(this.device, this.energy, 4),
    ]);
    const encoded = new Uint32Array(raw);
    const boxes = new Float32Array(this.components * 4);
    for (let c = 0; c < this.components; c++) {
      boxes[c * 4] = unordered(~(encoded[c * 4] ?? 0) >>> 0);
      boxes[c * 4 + 1] = unordered(~(encoded[c * 4 + 1] ?? 0) >>> 0);
      boxes[c * 4 + 2] = unordered(encoded[c * 4 + 2] ?? 0);
      boxes[c * 4 + 3] = unordered(encoded[c * 4 + 3] ?? 0);
    }
    return { boxes, energy: (new Uint32Array(energy)[0] ?? 0) / 16 / Math.max(count, 1) };
  }

  destroy(): void {
    this.level.destroy();
    this.shared.destroy();
  }

  private budget(level: number): number {
    return this.hierarchy.levels[level]?.iterations ?? 0;
  }

  private createLevel(index: number): GpuLevel {
    const input = this.hierarchy.levels[index];
    if (!input) throw new Error(`no level ${index}`);
    return new GpuLevel(
      this.kernels,
      this.device,
      input,
      { state: this.state, energy: this.energy },
      levelSeed(this.seed, index),
    );
  }

  private descend(): void {
    const index = this.levelIndex - 1;
    const coarse = this.level;
    const finer = this.createLevel(index);
    const temporary = new Buffers(this.device);
    const parent = temporary.upload('parent', this.hierarchy.levels[index]?.parent ?? new Uint32Array());
    const children = temporary.upload('children', this.hierarchy.levels[index + 1]?.children ?? new Uint32Array());
    const pull = temporary.storage('pull', finer.count * 8);
    this.device.queue.writeBuffer(this.walk, 0, new Uint32Array([this.pointCount, index]));

    const encoder = this.device.createCommandEncoder({ label: 'descend' });
    const pass = encoder.beginComputePass({ label: 'prolong' });
    pass.setPipeline(this.kernels.pullChildren);
    pass.setBindGroup(
      0,
      bind(this.device, this.kernels.pullChildren, {
        0: finer.params,
        1: coarse.latest,
        2: finer.nodes,
        3: finer.edges,
        4: parent,
        5: pull,
      }),
    );
    pass.dispatchWorkgroups(groups(finer.count));
    pass.setPipeline(this.kernels.placeChildren);
    pass.setBindGroup(
      0,
      bind(this.device, this.kernels.placeChildren, {
        0: coarse.params,
        1: coarse.latest,
        5: pull,
        6: children,
        7: finer.latest,
      }),
    );
    pass.dispatchWorkgroups(groups(coarse.count));
    pass.end();
    this.level = finer;
    this.levelIndex = index;
    this.levelIteration = 0;
    this.encodeAncestors(encoder);
    this.device.queue.submit([encoder.finish()]);
    temporary.destroy();
    coarse.destroy();
  }

  private encodeAncestors(encoder: GPUCommandEncoder): void {
    const pass = encoder.beginComputePass({ label: 'ancestors' });
    pass.setPipeline(this.kernels.findAncestors);
    pass.setBindGroup(
      0,
      bind(this.device, this.kernels.findAncestors, {
        0: this.walk,
        1: this.parents,
        2: this.sizes,
        3: this.ancestors,
      }),
    );
    pass.dispatchWorkgroups(groups(this.pointCount));
    pass.end();
  }
}
