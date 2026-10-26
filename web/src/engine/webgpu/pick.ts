import { ID_FORMAT, type Renderer, type View } from './renderer';

/** Ids are drawn at this fraction of the canvas resolution. */
const SCALE = 0.5;
/** `copyTextureToBuffer` rows must be multiples of 256 bytes (WebGPU spec, GPUImageCopyBuffer). */
const ROW_BYTES = 256;

/** The view the id texture shows at half resolution. */
export function idView(view: View): View {
  return {
    ...view,
    zoom: view.zoom * SCALE,
    width: Math.max(1, Math.ceil(view.width * SCALE)),
    height: Math.max(1, Math.ceil(view.height * SCALE)),
  };
}

/**
 * Segment ids drawn into an `r32uint` texture at half resolution. A pick reads
 * back the one texel under the cursor; the texture is redrawn only when the
 * view or the positions changed since it was last drawn.
 */
export class Picker {
  private texture: GPUTexture | undefined;
  private drawnFor: View | undefined;

  constructor(private readonly device: GPUDevice) {}

  /** Forgets the drawn ids, after the positions changed. */
  invalidate(): void {
    this.drawnFor = undefined;
  }

  /** The ids must be drawn again for `view`, after a fresh cull. */
  stale(view: View): boolean {
    return !sameView(this.drawnFor, view);
  }

  /**
   * Draws the ids for `view` if they are stale, then copies the texel under
   * canvas pixel `x, y` into `target`. Returns false when it lies outside.
   */
  encode(encoder: GPUCommandEncoder, renderer: Renderer, view: View, x: number, y: number, target: GPUBuffer): boolean {
    const ids = idView(view);
    const tx = Math.floor(x * SCALE);
    const ty = Math.floor(y * SCALE);
    if (tx < 0 || ty < 0 || tx >= ids.width || ty >= ids.height) return false;
    const texture = this.ensure(ids.width, ids.height);
    if (this.stale(view)) {
      const pass = encoder.beginRenderPass({
        label: 'ids',
        colorAttachments: [
          { view: texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        ],
      });
      renderer.drawIds(pass, ids);
      pass.end();
      this.drawnFor = view;
    }
    encoder.copyTextureToBuffer(
      { texture, origin: { x: tx, y: ty } },
      { buffer: target, bytesPerRow: ROW_BYTES },
      { width: 1, height: 1 },
    );
    return true;
  }

  /** A buffer `encode` can copy one texel into, to map and read with `read`. */
  staging(): GPUBuffer {
    return this.device.createBuffer({
      label: 'pick readback',
      size: 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  /** The segment in a mapped-to-be staging buffer, or undefined for background. */
  async read(staging: GPUBuffer): Promise<number | undefined> {
    try {
      await staging.mapAsync(GPUMapMode.READ);
      const id = new Uint32Array(staging.getMappedRange())[0] ?? 0;
      return id === 0 ? undefined : id - 1;
    } finally {
      staging.destroy();
    }
  }

  destroy(): void {
    this.texture?.destroy();
    this.texture = undefined;
  }

  private ensure(width: number, height: number): GPUTexture {
    const t = this.texture;
    if (t?.width === width && t.height === height) return t;
    t?.destroy();
    this.drawnFor = undefined;
    this.texture = this.device.createTexture({
      label: 'segment ids',
      size: { width, height },
      format: ID_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    return this.texture;
  }
}

function sameView(a: View | undefined, b: View): boolean {
  return (
    a !== undefined &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.zoom === b.zoom &&
    a.width === b.width &&
    a.height === b.height
  );
}
