import type { Geometry } from '../../workers/protocol/layout';
import type { Backend, BackendEvents, Style, View } from '../core/backend';
import { palettes } from '../style/palette';
import { LINK_WIDTH, linkFade, RIBBON_WIDTH } from '../style/widths';
import { createGpuContext } from './device';
import { PassTiming } from './layout/gpu';
import { GpuLayoutDriver } from './layout/GpuLayoutDriver';
import { createKernels, type Kernels } from './layout/kernels';
import { Renderer } from './renderer';

export class WebGpuBackend implements Backend {
  readonly kind = 'webgpu';
  readonly layout: GpuLayoutDriver;
  private readonly renderer: Renderer;
  private style: Style = { theme: 'light' };
  private destroyed = false;
  private draws = 0;
  private gpuDrawMs = 0;

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    format: GPUTextureFormat,
    kernels: Kernels,
    events: BackendEvents,
  ) {
    this.renderer = new Renderer(device, format, kernels);
    this.layout = new GpuLayoutDriver(device, kernels, events, () => this.renderer.positionBuffer);
    device.addEventListener('uncapturederror', (event) => {
      events.error(event.error.message);
    });
    void device.lost.then((info) => {
      if (!this.destroyed) events.lost(info.message || info.reason);
    });
  }

  static async create(canvas: HTMLCanvasElement, events: BackendEvents): Promise<WebGpuBackend> {
    const { device, context, format } = await createGpuContext(canvas);
    const kernels = await createKernels(device).catch((error: unknown) => {
      device.destroy();
      throw error;
    });
    return new WebGpuBackend(device, context, format, kernels, events);
  }

  get maxCanvasSize(): number {
    return this.device.limits.maxTextureDimension2D;
  }

  get drawMs(): number {
    return this.gpuDrawMs;
  }

  setGraph(geometry: Geometry, colors: Uint32Array<ArrayBuffer>): void {
    this.layout.stop();
    this.renderer.setGeometry(geometry, colors);
  }

  setStyle(style: Style): void {
    this.style = style;
  }

  setPositions(positions: Float32Array<ArrayBuffer>): void {
    this.layout.stop();
    this.renderer.setPositions(positions);
  }

  draw(view: View): void {
    const palette = palettes[this.style.theme];
    const [r, g, b, a] = palette.background;
    const encoder = this.device.createCommandEncoder({ label: 'frame' });
    // Every draw is timed while the layout runs, for its redraw budget, and
    // one in eight otherwise, for the frame rate.
    const timed = this.device.features.has('timestamp-query') && (this.layout.busy || this.draws % 8 === 0);
    this.draws++;
    const timing = timed ? new PassTiming(this.device) : undefined;
    const drawn = {
      ...view,
      ribbonHalf: RIBBON_WIDTH / 2,
      linkHalf: LINK_WIDTH / 2,
      linkAlpha: linkFade(view.zoom),
      linkColor: palette.link,
    };
    this.renderer.cull(encoder, drawn);
    const pass = encoder.beginRenderPass({
      ...(timing && { timestampWrites: timing.writes }),
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r, g, b, a },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    this.renderer.draw(pass, drawn);
    pass.end();
    timing?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    void timing?.ms().then((ms) => {
      this.gpuDrawMs = this.gpuDrawMs * 0.7 + ms * 0.3;
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.layout.destroy();
    this.renderer.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }
}
