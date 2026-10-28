import type { Geometry } from '../../workers/protocol/layout';
import type { Backend, BackendEvents, LabelMetrics, PlacedLabels, SegmentData, Style, View } from '../core/backend';
import type { Bounds } from '../core/camera';
import { DEFAULT_DISPLAY } from '../style/display';
import { palettes } from '../style/palette';
import { RIBBON_WIDTH, STRAND_SHIFT } from '../style/widths';
import { drawnView } from '../style/uniforms';
import { createGpuContext } from './device';
import type { Atlas } from '../text/Atlas';
import { GlyphRenderer } from './glyphs';
import { LabelPlacer } from './labels';
import { Buffers, gpuBytes, PassTiming } from './layout/gpu';
import { GpuLayoutDriver } from './layout/GpuLayoutDriver';
import { createKernels, type Kernels } from './layout/kernels';
import { Picker } from './pick';
import { Queries } from './query';
import { Renderer, type View as DrawnView } from './renderer';

export class WebGpuBackend implements Backend {
  readonly kind = 'webgpu';
  readonly layout: GpuLayoutDriver;
  private readonly renderer: Renderer;
  private readonly picker: Picker;
  private readonly queries: Queries;
  private readonly labelBuffers: Buffers;
  private readonly placer: LabelPlacer;
  private readonly glyphs: GlyphRenderer;
  private fontPx = 0;
  private style: Style = { theme: 'light', display: DEFAULT_DISPLAY };
  private lastView: View | undefined;
  private hover: number | undefined;
  /** A new graph's position buffer holds zeros until positions arrive; drawing them stacks every ribbon on one point. */
  private positioned = false;
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
    this.picker = new Picker(device);
    this.queries = new Queries(device, kernels);
    this.labelBuffers = new Buffers(device);
    this.placer = new LabelPlacer(device, kernels);
    this.glyphs = new GlyphRenderer(device, format, this.labelBuffers);
    this.layout = new GpuLayoutDriver(
      device,
      kernels,
      events,
      () => this.renderer.positionBuffer,
      () => {
        this.positioned = true;
        this.picker.invalidate();
      },
      () => this.renderer.drawn,
    );
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

  get gpuBytes(): number {
    return gpuBytes();
  }

  setGraph(geometry: Geometry, segments: SegmentData, seed: number): void {
    this.layout.stop();
    this.renderer.setGeometry(geometry, segments, seed);
    this.placer.setSizes(undefined);
    this.glyphs.setSource(this.renderer.drawn);
    this.layout.setSegments(geometry.segmentStarts, geometry.segmentPieces);
    this.positioned = false;
    this.picker.invalidate();
  }

  setStyle(style: Style): void {
    this.style = style;
    this.renderer.setStyle(style);
  }

  setPositions(positions: Float32Array<ArrayBuffer>): void {
    this.layout.stop();
    this.renderer.setPositions(positions);
    this.positioned = true;
    this.picker.invalidate();
  }

  setSelection(bits: Uint32Array<ArrayBuffer>, count: number): void {
    this.renderer.setSelection(bits, count);
  }

  setHover(segment: number | undefined): void {
    this.hover = segment;
  }

  setPathColors(colors: Uint32Array<ArrayBuffer>): void {
    this.renderer.setPathColors(colors);
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
    this.lastView = view;
    const drawn = this.drawn(view);
    if (this.positioned) this.renderer.cull(encoder, drawn);
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
    if (this.positioned) {
      this.renderer.draw(pass, drawn);
      this.glyphs.draw(pass, view, { color: palette.label, halo: palette.background }, this.fontPx);
    }
    pass.end();
    timing?.resolve(encoder);
    this.device.queue.submit([encoder.finish()]);
    void timing?.ms().then((ms) => {
      this.gpuDrawMs = this.gpuDrawMs * 0.7 + ms * 0.3;
    });
  }

  async pick(x: number, y: number): Promise<number | undefined> {
    if (!this.lastView || !this.positioned || this.destroyed) return undefined;
    const drawn = this.drawn(this.lastView);
    const encoder = this.device.createCommandEncoder({ label: 'pick' });
    if (this.picker.stale(drawn)) this.renderer.cull(encoder, drawn);
    const staging = this.picker.staging();
    if (!this.picker.encode(encoder, this.renderer, drawn, x, y, staging)) {
      staging.destroy();
      return undefined;
    }
    this.device.queue.submit([encoder.finish()]);
    return this.picker.read(staging);
  }

  async selectBox(box: Bounds): Promise<Uint32Array<ArrayBuffer>> {
    const view = this.lastView;
    const drawn = this.renderer.drawn;
    if (!view || !drawn || !this.positioned) return new Uint32Array(0);
    const world = (x: number, y: number) => [
      view.centerX + (x - view.width / 2) / view.zoom,
      view.centerY + (y - view.height / 2) / view.zoom,
    ];
    const [minX = 0, minY = 0] = world(box.minX, box.minY);
    const [maxX = 0, maxY = 0] = world(box.maxX, box.maxY);
    const shift = this.style.display.double ? STRAND_SHIFT : 0;
    const half = Math.max(RIBBON_WIDTH / 2, 0.5 / view.zoom) + shift;
    return this.queries.selectBox(drawn, { minX, minY, maxX, maxY }, half);
  }

  async bounds(of: Uint32Array<ArrayBuffer>): Promise<Bounds | undefined> {
    const drawn = this.renderer.drawn;
    if (!drawn || !this.positioned) return undefined;
    return this.queries.bounds(drawn, of);
  }

  setAtlas(atlas: Atlas): void {
    this.glyphs.setAtlas(atlas);
  }

  setLabelSizes(sizes: Uint32Array<ArrayBuffer> | undefined): void {
    this.placer.setSizes(sizes);
  }

  async placeLabels(metrics: LabelMetrics): Promise<PlacedLabels> {
    const view = this.lastView;
    const drawn = this.renderer.drawn;
    if (!view || !drawn || !this.positioned || this.destroyed) {
      return { segments: new Uint32Array(0), ranks: new Uint32Array(0) };
    }
    return this.placer.place(drawn, { ...view, ...metrics });
  }

  setLabels(glyphs: Float32Array<ArrayBuffer>, fontPx: number): void {
    this.glyphs.setGlyphs(glyphs);
    this.fontPx = fontPx;
  }

  private drawn(view: View): DrawnView {
    return drawnView(view, this.style, this.hover);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.layout.destroy();
    this.placer.destroy();
    this.glyphs.destroy();
    this.labelBuffers.destroy();
    this.picker.destroy();
    this.renderer.destroy();
    this.context.unconfigure();
    this.device.destroy();
  }
}
