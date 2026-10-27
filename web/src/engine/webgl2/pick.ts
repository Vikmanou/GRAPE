import type { DrawnView } from '../style/uniforms';
import { idTexel, idView } from '../core/idView';
import type { Renderer } from './renderer';

function sameView(a: DrawnView | undefined, b: DrawnView): boolean {
  return (
    a !== undefined &&
    a.centerX === b.centerX &&
    a.centerY === b.centerY &&
    a.zoom === b.zoom &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * Segment ids drawn into an `R32UI` texture at half resolution, as the WebGPU
 * picker does. A pick reads back the one texel under the cursor through a
 * pixel buffer and a fence, so the main thread never waits on the GPU.
 */
export class Picker {
  private texture: WebGLTexture | undefined;
  private framebuffer: WebGLFramebuffer | undefined;
  private size = { width: 0, height: 0 };
  private drawnFor: DrawnView | undefined;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  invalidate(): void {
    this.drawnFor = undefined;
  }

  async pick(renderer: Renderer, view: DrawnView, x: number, y: number): Promise<number | undefined> {
    const gl = this.gl;
    const ids = idView(view);
    const [tx, ty] = idTexel(x, y);
    if (tx < 0 || ty < 0 || tx >= ids.width || ty >= ids.height) return undefined;
    const framebuffer = this.ensure(ids.width, ids.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    if (!sameView(this.drawnFor, view)) {
      gl.viewport(0, 0, ids.width, ids.height);
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array(4));
      renderer.drawIds(ids);
      this.drawnFor = view;
    }
    const staging = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ);
    // GL counts rows from the bottom; canvas pixels from the top.
    gl.readPixels(tx, ids.height - 1 - ty, 1, 1, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    try {
      while (sync && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      if (gl.isContextLost()) return undefined;
      const out = new Uint32Array(4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const id = out[0] ?? 0;
      return id === 0 ? undefined : id - 1;
    } finally {
      gl.deleteSync(sync);
      gl.deleteBuffer(staging);
    }
  }

  destroy(): void {
    this.gl.deleteFramebuffer(this.framebuffer ?? null);
    this.gl.deleteTexture(this.texture ?? null);
  }

  private ensure(width: number, height: number): WebGLFramebuffer {
    const gl = this.gl;
    if (this.framebuffer && this.size.width === width && this.size.height === height) return this.framebuffer;
    this.destroy();
    this.drawnFor = undefined;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32UI, width, height);
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.texture = texture;
    this.framebuffer = framebuffer;
    this.size = { width, height };
    return framebuffer;
  }
}
