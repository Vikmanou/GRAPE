export const WORKGROUP = 256;

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

  get bytes(): number {
    return this.owned.reduce((sum, b) => sum + b.size, 0);
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
