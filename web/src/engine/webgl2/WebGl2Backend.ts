import type { Geometry, PositionGrid } from '../../workers/protocol/layout';
import type { Backend, BackendEvents, LabelMetrics, PlacedLabels, SegmentData, Style, View } from '../core/backend';
import type { Bounds } from '../core/camera';
import type { Hidden } from '../core/Visibility';
import { CpuLayoutDriver } from '../core/CpuLayoutDriver';
import { DEFAULT_DISPLAY } from '../style/display';
import { palettes } from '../style/palette';
import { drawnView } from '../style/uniforms';
import { RIBBON_WIDTH, STRAND_SHIFT } from '../style/widths';
import type { Atlas } from '../text/Atlas';
import { Resources } from './context';
import { GlyphRenderer } from './glyphs';
import { boundsOfSegments, collect, pieceTouches, selectBox } from './grid';
import { placeLabels } from './labels';
import { Picker } from './pick';
import { Renderer } from './renderer';

const NO_LABELS: PlacedLabels = { segments: new Uint32Array(0), ranks: new Uint32Array(0) };

/**
 * The fallback backend: the same pictures as WebGPU drawn with instanced
 * WebGL2, positions from the CPU layout in the layout worker, and culling,
 * box select and label placement on the CPU over the worker's grid.
 */
export class WebGl2Backend implements Backend {
  readonly kind = 'webgl2';
  readonly layout: CpuLayoutDriver;
  readonly drawMs = 0;
  private readonly res: Resources;
  private readonly renderer: Renderer;
  private readonly picker: Picker;
  private readonly glyphs: GlyphRenderer;
  private style: Style = { theme: 'light', display: DEFAULT_DISPLAY };
  private lastView: View | undefined;
  private hover: number | undefined;
  private positioned = false;
  private destroyed = false;
  private fontPx = 0;
  private labelSizes: Uint32Array | undefined;
  /** The widest label, in characters and lines, for padding placement's view. */
  private widestLabel = { chars: 0, lines: 0 };
  private scratch = { marks: new Uint32Array(0), items: new Uint32Array(0) };

  private constructor(
    private readonly gl: WebGL2RenderingContext,
    events: BackendEvents,
  ) {
    this.res = new Resources(gl);
    this.renderer = new Renderer(this.res);
    this.picker = new Picker(gl);
    this.glyphs = new GlyphRenderer(this.res);
    this.layout = new CpuLayoutDriver(
      (request) => {
        events.control?.(request);
      },
      () => this.renderer.current?.selected,
      (active) => {
        events.refining(active);
      },
    );
    const canvas = gl.canvas as HTMLCanvasElement;
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      if (!this.destroyed) events.lost('WebGL context lost');
    });
  }

  static create(canvas: HTMLCanvasElement, events: BackendEvents): Promise<WebGl2Backend> {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      powerPreference: 'high-performance',
    });
    if (!gl) return Promise.reject(new Error('canvas.getContext("webgl2") returned null'));
    return Promise.resolve(new WebGl2Backend(gl, events));
  }

  get maxCanvasSize(): number {
    const [w = 0, h = 0] = this.gl.getParameter(this.gl.MAX_VIEWPORT_DIMS) as Int32Array;
    return Math.min(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number, w, h);
  }

  get gpuBytes(): number {
    return this.res.bytes;
  }

  setGraph(geometry: Geometry, segments: SegmentData, seed: number): void {
    this.renderer.setGeometry(geometry, segments, seed);
    const graph = this.renderer.current;
    const [positions, , table] = graph?.textures ?? [];
    this.glyphs.setSource(positions && table ? { positions, table, segments: geometry.segments } : undefined);
    this.scratch = {
      marks: new Uint32Array(Math.ceil(geometry.pieces.length / 2 / 32)),
      items: new Uint32Array(geometry.pieces.length / 2),
    };
    this.setLabelSizes(undefined);
    this.layout.reset();
    this.positioned = false;
    this.picker.invalidate();
  }

  setStyle(style: Style): void {
    this.style = style;
    this.renderer.setStyle(style);
    this.picker.invalidate();
  }

  setPositions(positions: Float32Array<ArrayBuffer>, grid?: PositionGrid): void {
    this.renderer.setPositions(positions, grid);
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

  setVisibility(hidden: Hidden): void {
    this.renderer.setVisibility(hidden);
    this.picker.invalidate();
  }

  draw(view: View): void {
    const gl = this.gl;
    const palette = palettes[this.style.theme];
    const [r, g, b, a] = palette.background;
    this.lastView = view;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    gl.clearColor(r, g, b, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!this.positioned) return;
    this.renderer.draw(drawnView(view, this.style, this.hover));
    this.glyphs.draw(view, { color: palette.label, halo: palette.background }, this.fontPx);
  }

  async pick(x: number, y: number): Promise<number | undefined> {
    const view = this.lastView;
    if (!view || !this.positioned || this.destroyed) return undefined;
    return this.picker.pick(this.renderer, drawnView(view, this.style, this.hover), x, y);
  }

  selectBox(box: Bounds): Promise<Uint32Array<ArrayBuffer>> {
    const view = this.lastView;
    const graph = this.renderer.current;
    if (!view || !graph?.grid || !this.positioned) return Promise.resolve(new Uint32Array(0));
    const world = (x: number, y: number) => [
      view.centerX + (x - view.width / 2) / view.zoom,
      view.centerY + (y - view.height / 2) / view.zoom,
    ];
    const [minX = 0, minY = 0] = world(box.minX, box.minY);
    const [maxX = 0, maxY = 0] = world(box.maxX, box.maxY);
    const shift = this.style.display.double ? STRAND_SHIFT : 0;
    const half = Math.max(RIBBON_WIDTH / 2, 0.5 / view.zoom) + shift;
    const g = { positions: graph.positions, pieces: graph.geometry.pieces, links: graph.geometry.links };
    const { marks, items } = this.scratch;
    return Promise.resolve(
      selectBox(g, graph.grid, graph.geometry.segments, { minX, minY, maxX, maxY }, half, marks, items),
    );
  }

  bounds(of: Uint32Array<ArrayBuffer>): Promise<Bounds | undefined> {
    const graph = this.renderer.current;
    if (!graph || !this.positioned) return Promise.resolve(undefined);
    const { segmentStarts, segmentPieces } = graph.geometry;
    return Promise.resolve(boundsOfSegments(graph.positions, segmentStarts, segmentPieces, of));
  }

  setAtlas(atlas: Atlas): void {
    this.glyphs.setAtlas(atlas);
  }

  setLabelSizes(sizes: Uint32Array<ArrayBuffer> | undefined): void {
    this.labelSizes = sizes && sizes.length > 0 ? sizes : undefined;
    const n = sizes ? sizes.length / 2 : 0;
    let [chars, lines] = [0, 0];
    for (let s = 0; s < n; s++) {
      const size = sizes?.[n + s] ?? 0;
      chars = Math.max(chars, size & 0xffff);
      lines = Math.max(lines, size >>> 16);
    }
    this.widestLabel = { chars, lines };
  }

  /** Candidates are the segments with a piece near the view, padded by the widest label. */
  placeLabels(metrics: LabelMetrics): Promise<PlacedLabels> {
    const view = this.lastView;
    const graph = this.renderer.current;
    const sizes = this.labelSizes;
    if (!view || !graph?.grid || !sizes || !this.positioned || this.destroyed) return Promise.resolve(NO_LABELS);
    const padX = (this.widestLabel.chars * metrics.advance) / 2 / view.zoom;
    const padY = (this.widestLabel.lines * metrics.lineHeight) / 2 / view.zoom;
    const area = {
      minX: view.centerX - view.width / 2 / view.zoom - padX,
      minY: view.centerY - view.height / 2 / view.zoom - padY,
      maxX: view.centerX + view.width / 2 / view.zoom + padX,
      maxY: view.centerY + view.height / 2 / view.zoom + padY,
    };
    const { pieces, links, segments, segmentStarts, segmentPieces } = graph.geometry;
    const g = { positions: graph.positions, pieces, links };
    const { marks, items } = this.scratch;
    const count = collect(graph.grid, graph.grid.pieces, area, marks, items, (p) => pieceTouches(g, p, area));
    const seen = new Uint8Array(segments);
    const candidates: number[] = [];
    for (let i = 0; i < count; i++) {
      const segment = pieces[(items[i] ?? 0) * 2 + 1] ?? 0;
      if (seen[segment] === 0) {
        seen[segment] = 1;
        candidates.push(segment);
      }
    }
    const chains = { positions: graph.positions, starts: segmentStarts, pieces: segmentPieces };
    return Promise.resolve(placeLabels(chains, sizes, candidates, { ...view, ...metrics }));
  }

  setLabels(glyphs: Float32Array<ArrayBuffer>, fontPx: number): void {
    this.glyphs.setGlyphs(glyphs);
    this.fontPx = fontPx;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.glyphs.destroy();
    this.picker.destroy();
    this.renderer.destroy();
    this.res.destroy();
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
