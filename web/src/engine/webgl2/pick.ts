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

interface Pending {
  x: number;
  y: number;
  resolve: (segment: number | undefined) => void;
}

/**
 * Segment ids drawn into an `R32UI` texture at half resolution, as the WebGPU
 * picker does. Picks asked for in the same task share one read of the texels
 * around them, through a pixel buffer and a fence, so the main thread never
 * waits on the GPU.
 */
export class Picker {
  private texture: WebGLTexture | undefined;
  private framebuffer: WebGLFramebuffer | undefined;
  private size = { width: 0, height: 0 };
  private drawnFor: DrawnView | undefined;
  private pending: Pending[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {}

  invalidate(): void {
    this.drawnFor = undefined;
  }

  pick(renderer: Renderer, view: DrawnView, x: number, y: number): Promise<number | undefined> {
    const gl = this.gl;
    const ids = idView(view);
    const [tx, ty] = idTexel(x, y);
    if (tx < 0 || ty < 0 || tx >= ids.width || ty >= ids.height) return Promise.resolve(undefined);
    if (!sameView(this.drawnFor, view) || this.size.width !== ids.width || this.size.height !== ids.height) {
      // Picks waiting on the old ids read them before they are redrawn.
      this.flush();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ensure(ids.width, ids.height));
      gl.viewport(0, 0, ids.width, ids.height);
      gl.clearBufferuiv(gl.COLOR, 0, new Uint32Array(4));
      renderer.drawIds(ids);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.drawnFor = view;
    }
    return new Promise((resolve) => {
      if (this.pending.length === 0)
        queueMicrotask(() => {
          this.flush();
        });
      // GL counts rows from the bottom; canvas pixels from the top.
      this.pending.push({ x: tx, y: ids.height - 1 - ty, resolve });
    });
  }

  /** Reads the texels of every waiting pick in one go, and answers them once the GPU is done. */
  private flush(): void {
    const picks = this.pending;
    this.pending = [];
    if (picks.length === 0 || !this.framebuffer) return;
    const gl = this.gl;
    const x0 = Math.min(...picks.map((p) => p.x));
    const y0 = Math.min(...picks.map((p) => p.y));
    const width = Math.max(...picks.map((p) => p.x)) - x0 + 1;
    const height = Math.max(...picks.map((p) => p.y)) - y0 + 1;
    const staging = gl.createBuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, width * height * 16, gl.STREAM_READ);
    gl.readPixels(x0, y0, width, height, gl.RGBA_INTEGER, gl.UNSIGNED_INT, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    void this.answer(sync, staging, picks, { x0, y0, width, height });
  }

  private async answer(
    sync: WebGLSync | null,
    staging: WebGLBuffer,
    picks: Pending[],
    rect: { x0: number; y0: number; width: number; height: number },
  ): Promise<void> {
    const gl = this.gl;
    try {
      while (sync && gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      if (gl.isContextLost()) throw new Error('context lost');
      const texels = new Uint32Array(rect.width * rect.height * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, staging);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, texels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      for (const p of picks) {
        const id = texels[((p.y - rect.y0) * rect.width + (p.x - rect.x0)) * 4] ?? 0;
        p.resolve(id === 0 ? undefined : id - 1);
      }
    } catch {
      for (const p of picks) p.resolve(undefined);
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
