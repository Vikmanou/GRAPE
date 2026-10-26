export const WORKGROUP = 256;

/** Timestamp writes for a named pass, when profiling. */
export type PassTimer = (label: string) => GPUComputePassTimestampWrites | undefined;

export function groups(n: number, perGroup = WORKGROUP): number {
  return Math.ceil(n / perGroup);
}

export function nextPowerOfTwo(n: number): number {
  return 2 ** Math.ceil(Math.log2(Math.max(n, 1)));
}

/** Creates buffers and destroys them all together. */
export class Buffers {
  private owned: GPUBuffer[] = [];

  constructor(readonly device: GPUDevice) {}

  /** Storage bindings cannot be empty, so every buffer holds at least 16 bytes. */
  storage(label: string, bytes: number, usage = 0): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(16, Math.ceil(bytes / 16) * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC | usage,
    });
    this.owned.push(buffer);
    return buffer;
  }

  upload(label: string, data: Uint32Array<ArrayBuffer> | Float32Array<ArrayBuffer>, usage = 0): GPUBuffer {
    const buffer = this.storage(label, data.byteLength, usage);
    if (data.byteLength > 0) this.device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  }

  uniform(label: string, data: ArrayBuffer): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: Math.ceil(data.byteLength / 16) * 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(buffer, 0, data);
    this.owned.push(buffer);
    return buffer;
  }

  destroy(): void {
    for (const buffer of this.owned) buffer.destroy();
    this.owned = [];
  }
}

export function bind(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  buffers: Record<number, GPUBuffer>,
): GPUBindGroup {
  return device.createBindGroup({
    label: pipeline.label,
    layout: pipeline.getBindGroupLayout(0),
    entries: Object.entries(buffers).map(([binding, buffer]) => ({ binding: Number(binding), resource: { buffer } })),
  });
}

export async function readBuffer(device: GPUDevice, source: GPUBuffer, bytes = source.size): Promise<ArrayBuffer> {
  const staging = device.createBuffer({
    label: 'readback',
    size: bytes,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  const encoder = device.createCommandEncoder({ label: 'readback' });
  encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const copy = staging.getMappedRange().slice(0);
  staging.destroy();
  return copy;
}

/** The most workgroups one dispatch dimension may have (WebGPU's default limit). */
export const MAX_GROUPS = 65_535;

/**
 * Hands out compute passes: one pass shared by every section, or a timed
 * pass per section when profiling.
 */
export class Passes {
  private pass: GPUComputePassEncoder | undefined;

  /** `timer` times each section; `whole` times the shared pass. */
  constructor(
    private readonly encoder: GPUCommandEncoder,
    private readonly timer?: PassTimer,
    private readonly whole?: GPUComputePassTimestampWrites,
  ) {}

  section(label: string): GPUComputePassEncoder {
    if (this.timer) {
      this.pass?.end();
      const timestampWrites = this.timer(label);
      this.pass = this.encoder.beginComputePass(timestampWrites ? { label, timestampWrites } : { label });
    }
    this.pass ??= this.encoder.beginComputePass(
      this.whole ? { label: 'layout', timestampWrites: this.whole } : { label: 'layout' },
    );
    return this.pass;
  }

  end(): void {
    this.pass?.end();
    this.pass = undefined;
  }
}

/** GPU time of one pass, from a pair of timestamps. */
export class PassTiming {
  private readonly querySet: GPUQuerySet;
  private readonly resolved: GPUBuffer;
  private readonly read: GPUBuffer;

  constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({ type: 'timestamp', count: 2 });
    this.resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    this.read = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  }

  /** For a compute or a render pass, which take the same shape. */
  get writes(): GPUComputePassTimestampWrites {
    return { querySet: this.querySet, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 };
  }

  resolve(encoder: GPUCommandEncoder): void {
    encoder.resolveQuerySet(this.querySet, 0, 2, this.resolved, 0);
    encoder.copyBufferToBuffer(this.resolved, 0, this.read, 0, 16);
  }

  /** Resolves once the pass has run; frees the timing's GPU objects. */
  async ms(): Promise<number> {
    try {
      await this.read.mapAsync(GPUMapMode.READ);
      const [start = 0n, end = 0n] = new BigInt64Array(this.read.getMappedRange());
      return Number(end - start) / 1e6;
    } finally {
      this.querySet.destroy();
      this.resolved.destroy();
      this.read.destroy();
    }
  }
}
