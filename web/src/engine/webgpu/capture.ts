/** WebGPU copies texture rows to buffers in multiples of this many bytes (WebGPU spec, `copyTextureToBuffer`). */
const ROW_ALIGNMENT = 256;

/** A texture to draw an export tile into, in the canvas's format so the same pipelines draw it. */
export function captureTarget(device: GPUDevice, format: GPUTextureFormat, width: number, height: number): GPUTexture {
  return device.createTexture({
    label: 'capture',
    size: [width, height],
    format,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
}

/**
 * Copies `texture` out after the commands in `encoder`, as RGBA8 rows from
 * the top. Submits the encoder and destroys the texture.
 */
export async function readTexture(
  device: GPUDevice,
  encoder: GPUCommandEncoder,
  texture: GPUTexture,
): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height, format } = texture;
  const row = width * 4;
  const stride = Math.ceil(row / ROW_ALIGNMENT) * ROW_ALIGNMENT;
  const staging = device.createBuffer({
    label: 'capture staging',
    size: stride * height,
    usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
  });
  encoder.copyTextureToBuffer({ texture }, { buffer: staging, bytesPerRow: stride }, [width, height]);
  device.queue.submit([encoder.finish()]);
  try {
    await staging.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(staging.getMappedRange());
    const out = new Uint8Array(row * height);
    for (let y = 0; y < height; y++) out.set(mapped.subarray(y * stride, y * stride + row), y * row);
    if (format === 'bgra8unorm') {
      for (let i = 0; i < out.length; i += 4) {
        const blue = out[i] ?? 0;
        out[i] = out[i + 2] ?? 0;
        out[i + 2] = blue;
      }
    }
    return out;
  } finally {
    staging.destroy();
    texture.destroy();
  }
}
