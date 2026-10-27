import type { Geometry } from '../../workers/protocol/layout';
import type { Rgba } from '../style/palette';
import { Cull, type CullView } from './cull';
import { Buffers } from './layout/gpu';
import type { Kernels } from './layout/kernels';
import shader from './shaders/graph.wgsl?raw';

/** Matches `View` in graph.wgsl: 22 words, padded to 24. */
const VIEW_BYTES = 96;
const LINK_STEPS = 16;
/** `vertexCount, instanceCount, firstVertex, firstInstance` for links, pieces, then highlighted pieces. */
const INDIRECT = [LINK_STEPS * 6, 0, 0, 0, 6, 0, 0, 0, 6, 0, 0, 0];
const PIECES_INDIRECT = 16;
const HIGHLIGHT_INDIRECT = 32;
const NO_SEGMENT = 0xffffffff;
export const ID_FORMAT = 'r32uint';

export interface View {
  centerX: number;
  centerY: number;
  /** Pixels per world unit. */
  zoom: number;
  width: number;
  height: number;
  ribbonHalf: number;
  linkHalf: number;
  linkAlpha: number;
  linkColor: Rgba;
  outline: Rgba;
  hoverOutline: Rgba;
  /** Width of the selection outline in world units. */
  outlineWidth: number;
  hover: number | undefined;
}

interface Graph {
  buffers: Buffers;
  positions: GPUBuffer;
  selected: GPUBuffer;
  indirect: GPUBuffer;
  pieces: Cull | undefined;
  links: Cull | undefined;
  highlight: Cull | undefined;
  groups: Record<Pass, GPUBindGroup>;
}

/** Each pass draws with its own view uniform. */
type Pass = 'graph' | 'ids' | 'outline' | 'fill';

/**
 * Draws ribbons and links instanced over the pieces and links a compute pass
 * finds in view, so a zoomed-in view only pays for what it shows. Selected
 * and hovered segments are drawn again on top: an outline capsule, then the
 * ribbon narrowed by the same amount, so a segment's outline never crosses
 * its own joins.
 */
export class Renderer {
  private readonly ribbon: GPURenderPipeline;
  private readonly link: GPURenderPipeline;
  private readonly outline: GPURenderPipeline;
  private readonly ribbonIds: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly views: Record<Pass, GPUBuffer>;
  private readonly viewData = new ArrayBuffer(VIEW_BYTES);
  private graph: Graph | undefined;
  private selectedCount = 0;

  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    private readonly kernels: Kernels,
  ) {
    const module = device.createShaderModule({ label: 'graph', code: shader });
    const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const storage = { type: 'read-only-storage' } as const;
    this.layout = device.createBindGroupLayout({
      label: 'graph',
      entries: [
        { binding: 0, visibility, buffer: { type: 'uniform' } },
        ...[1, 2, 3, 4, 5, 6].map((binding) => ({ binding, visibility, buffer: storage })),
      ],
    });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [this.layout] });
    // Shaders output premultiplied alpha.
    const blend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    };
    const pipeline = (label: string, vertex: string, fragment: string, target: GPUColorTargetState) =>
      device.createRenderPipeline({
        label,
        layout: pipelineLayout,
        vertex: { module, entryPoint: vertex },
        fragment: { module, entryPoint: fragment, targets: [target] },
        primitive: { topology: 'triangle-list' },
      });
    this.ribbon = pipeline('ribbon', 'ribbon_vertex', 'ribbon_fragment', { format, blend });
    this.link = pipeline('link', 'link_vertex', 'link_fragment', { format, blend });
    this.outline = pipeline('outline', 'ribbon_vertex', 'ribbon_outline_fragment', { format, blend });
    this.ribbonIds = pipeline('ribbon ids', 'ribbon_vertex', 'ribbon_id_fragment', { format: ID_FORMAT });
    const uniform = (label: string) =>
      device.createBuffer({ label, size: VIEW_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.views = {
      graph: uniform('view'),
      ids: uniform('id view'),
      outline: uniform('outline view'),
      fill: uniform('fill view'),
    };
  }

  setGeometry(geometry: Geometry, colors: Uint32Array<ArrayBuffer>): void {
    this.graph?.buffers.destroy();
    const b = new Buffers(this.device);
    const pieceCount = geometry.pieces.length / 2;
    const linkCount = geometry.links.length / 4;
    const positions = b.storage('positions', geometry.points * 8);
    const pieces = b.upload('pieces', geometry.pieces);
    const links = b.upload('links', geometry.links);
    const selected = b.storage('selected segments', Math.ceil(geometry.segments / 32) * 4);
    const indirect = b.upload('draw arguments', Uint32Array.from(INDIRECT), GPUBufferUsage.INDIRECT);
    const cull = (kind: 'pieces' | 'links' | 'highlight', count: number, items: GPUBuffer, slot: number) =>
      count > 0
        ? new Cull(
            this.kernels,
            b,
            kind,
            count,
            positions,
            items,
            indirect,
            slot,
            kind === 'highlight' ? selected : undefined,
          )
        : undefined;
    const pieceCull = cull('pieces', pieceCount, pieces, PIECES_INDIRECT / 4 + 1);
    const linkCull = cull('links', linkCount, links, 1);
    const highlight = cull('highlight', pieceCount, pieces, HIGHLIGHT_INDIRECT / 4 + 1);
    const empty = b.storage('empty', 4);
    const colorBuffer = b.upload('colors', colors);
    const group = (pass: Pass, visiblePieces: GPUBuffer) =>
      this.device.createBindGroup({
        label: pass,
        layout: this.layout,
        entries: [
          this.views[pass],
          positions,
          pieces,
          colorBuffer,
          links,
          linkCull?.visible ?? empty,
          visiblePieces,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    const visible = pieceCull?.visible ?? empty;
    const lit = highlight?.visible ?? empty;
    this.selectedCount = 0;
    this.graph = {
      buffers: b,
      positions,
      selected,
      indirect,
      pieces: pieceCull,
      links: linkCull,
      highlight,
      groups: {
        graph: group('graph', visible),
        ids: group('ids', visible),
        outline: group('outline', lit),
        fill: group('fill', lit),
      },
    };
  }

  /** Where `x, y` per point, relative to the view's origin, are read from. */
  get positionBuffer(): GPUBuffer | undefined {
    return this.graph?.positions;
  }

  /** `x, y` per point, relative to the same origin as the view's centre. */
  setPositions(positions: Float32Array<ArrayBuffer>): void {
    const target = this.graph?.positions;
    if (target && positions.byteLength <= target.size) this.device.queue.writeBuffer(target, 0, positions);
  }

  /** One bit per segment, and how many are set. */
  setSelection(bits: Uint32Array<ArrayBuffer>, count: number): void {
    const target = this.graph?.selected;
    if (!target) return;
    this.device.queue.writeBuffer(target, 0, bits, 0, Math.min(bits.length, target.size / 4));
    this.selectedCount = count;
  }

  /** Finds what is in view; runs before the render pass that draws it. */
  cull(encoder: GPUCommandEncoder, view: View): void {
    const graph = this.graph;
    if (!graph || (!graph.pieces && !graph.links)) return;
    const worldPerPixel = 1 / view.zoom;
    const ribbonHalf = Math.max(view.ribbonHalf, worldPerPixel / 2);
    const area: CullView = {
      centerX: view.centerX,
      centerY: view.centerY,
      halfWidth: view.width / 2 / view.zoom,
      halfHeight: view.height / 2 / view.zoom,
      pad: ribbonHalf + view.outlineWidth + 2 * worldPerPixel,
      ribbonHalf: view.ribbonHalf,
      hover: view.hover,
    };
    const pass = encoder.beginComputePass({ label: 'cull' });
    graph.pieces?.encode(this.device, pass, area);
    if (view.linkAlpha > 0) graph.links?.encode(this.device, pass, area);
    if (this.highlighting(view)) graph.highlight?.encode(this.device, pass, area);
    pass.end();
  }

  draw(pass: GPURenderPassEncoder, view: View): void {
    const graph = this.graph;
    if (!graph) return;
    this.writeView('graph', view, 0);
    pass.setBindGroup(0, graph.groups.graph);
    // Links first, so ribbons cover their ends, as in Bandage.
    if (view.linkAlpha > 0 && graph.links) {
      pass.setPipeline(this.link);
      pass.drawIndirect(graph.indirect, 0);
    }
    if (!graph.pieces) return;
    pass.setPipeline(this.ribbon);
    pass.drawIndirect(graph.indirect, PIECES_INDIRECT);
    if (!this.highlighting(view)) return;
    this.writeView('outline', view, view.outlineWidth / 2);
    pass.setBindGroup(0, graph.groups.outline);
    pass.setPipeline(this.outline);
    pass.drawIndirect(graph.indirect, HIGHLIGHT_INDIRECT);
    this.writeView('fill', view, -view.outlineWidth / 2);
    pass.setBindGroup(0, graph.groups.fill);
    pass.setPipeline(this.ribbon);
    pass.drawIndirect(graph.indirect, HIGHLIGHT_INDIRECT);
  }

  /** Segment ids of the ribbons in view, into an `ID_FORMAT` target; reuses the last cull. */
  drawIds(pass: GPURenderPassEncoder, view: View): void {
    const graph = this.graph;
    if (!graph?.pieces) return;
    this.writeView('ids', view, 0);
    pass.setBindGroup(0, graph.groups.ids);
    pass.setPipeline(this.ribbonIds);
    pass.drawIndirect(graph.indirect, PIECES_INDIRECT);
  }

  private highlighting(view: View): boolean {
    return this.selectedCount > 0 || view.hover !== undefined;
  }

  private writeView(pass: Pass, view: View, grow: number): void {
    const f = new Float32Array(this.viewData);
    f.set([
      view.centerX,
      view.centerY,
      (view.zoom * 2) / view.width,
      (-view.zoom * 2) / view.height,
      1 / view.zoom,
      view.ribbonHalf,
      view.linkHalf,
      view.linkAlpha,
      ...view.linkColor,
      ...view.outline,
      ...view.hoverOutline,
      grow,
    ]);
    new Uint32Array(this.viewData)[21] = view.hover ?? NO_SEGMENT;
    this.device.queue.writeBuffer(this.views[pass], 0, this.viewData);
  }

  destroy(): void {
    this.graph?.buffers.destroy();
    this.graph = undefined;
    for (const view of Object.values(this.views)) view.destroy();
  }
}
