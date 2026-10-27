import type { Geometry } from '../../workers/protocol/layout';
import type { SegmentData, Style } from '../core/backend';
import { DEFAULT_DISPLAY } from '../style/display';
import { MAX_RIBBON_WIDTH, STRAND_SHIFT } from '../style/widths';
import { type DrawnView, packView, type StyledGraph, VIEW_BYTES } from '../style/uniforms';
import { Cull, type CullView } from './cull';
import { Buffers } from './layout/gpu';
import type { Kernels } from './layout/kernels';
import { StyleUniform, uploadSegments } from './segments';
import shader from './shaders/graph.wgsl?raw';

const LINK_STEPS = 16;
/** `vertexCount, instanceCount, firstVertex, firstInstance` for links, pieces, then highlighted pieces. */
const INDIRECT = [LINK_STEPS * 6, 0, 0, 0, 6, 0, 0, 0, 6, 0, 0, 0];
const PIECES_INDIRECT = 16;
const HIGHLIGHT_INDIRECT = 32;
export const ID_FORMAT = 'r32uint';

export type View = DrawnView;

/** What GPU queries over the drawn ribbons read. */
export interface Drawn {
  positions: GPUBuffer;
  pieces: GPUBuffer;
  pieceCount: number;
  segments: number;
  /** One bit per selected segment. */
  selected: GPUBuffer;
  /** The segment table of segments.ts. */
  table: GPUBuffer;
}

interface Graph extends Drawn {
  buffers: Buffers;
  selected: GPUBuffer;
  indirect: GPUBuffer;
  pieceCull: Cull | undefined;
  links: Cull | undefined;
  highlight: Cull | undefined;
  style: StyleUniform;
  styled: StyledGraph;
  /** One per strand. */
  groups: Record<Pass, GPUBindGroup[]>;
}

/** Each pass and strand draws with its own view uniform. */
type Pass = 'graph' | 'ids' | 'outline' | 'fill';
const PASSES: Pass[] = ['graph', 'ids', 'outline', 'fill'];

/** `strand` in graph.wgsl's view: 0 draws single mode, 1 and -1 the two strands of double mode. */
const SINGLE = [0];
const DOUBLE = [1, -1];

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
  private readonly views: Record<Pass, GPUBuffer[]>;
  private readonly viewData = new ArrayBuffer(VIEW_BYTES);
  private graph: Graph | undefined;
  private selectedCount = 0;
  private style: Style = { theme: 'light', display: DEFAULT_DISPLAY };

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
        ...[1, 2, 3, 4, 5, 6, 7].map((binding) => ({ binding, visibility, buffer: storage })),
        { binding: 8, visibility, buffer: { type: 'uniform' } },
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
    const uniforms = (pass: Pass) =>
      DOUBLE.map((strand) =>
        device.createBuffer({
          label: `${pass} view ${strand}`,
          size: VIEW_BYTES,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        }),
      );
    this.views = {
      graph: uniforms('graph'),
      ids: uniforms('ids'),
      outline: uniforms('outline'),
      fill: uniforms('fill'),
    };
  }

  setGeometry(geometry: Geometry, data: SegmentData, seed: number): void {
    this.graph?.buffers.destroy();
    const b = new Buffers(this.device);
    const table = uploadSegments(b, geometry, data);
    const styleUniform = new StyleUniform(b);
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
            geometry.segments,
            positions,
            items,
            indirect,
            slot,
            kind === 'pieces' ? table : undefined,
            kind === 'highlight' ? selected : undefined,
          )
        : undefined;
    const pieceCull = cull('pieces', pieceCount, pieces, PIECES_INDIRECT / 4 + 1);
    const linkCull = cull('links', linkCount, links, 1);
    const highlight = cull('highlight', pieceCount, pieces, HIGHLIGHT_INDIRECT / 4 + 1);
    const empty = b.storage('empty', 4);
    const group = (pass: Pass, view: GPUBuffer, visiblePieces: GPUBuffer) =>
      this.device.createBindGroup({
        label: pass,
        layout: this.layout,
        entries: [
          view,
          positions,
          pieces,
          table,
          links,
          linkCull?.visible ?? empty,
          visiblePieces,
          selected,
          styleUniform.buffer,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      });
    const visible = pieceCull?.visible ?? empty;
    const lit = highlight?.visible ?? empty;
    this.selectedCount = 0;
    this.graph = {
      buffers: b,
      positions,
      pieces,
      pieceCount,
      segments: geometry.segments,
      selected,
      table,
      indirect,
      pieceCull,
      links: linkCull,
      highlight,
      style: styleUniform,
      styled: { segments: geometry.segments, seed, meanDepth: data.meanDepth },
      groups: Object.fromEntries(
        PASSES.map((pass) => {
          const visiblePieces = pass === 'outline' || pass === 'fill' ? lit : visible;
          return [pass, this.views[pass].map((view) => group(pass, view, visiblePieces))];
        }),
      ) as Record<Pass, GPUBindGroup[]>,
    };
    this.writeStyle();
  }

  setStyle(style: Style): void {
    this.style = style;
    this.writeStyle();
  }

  private writeStyle(): void {
    const graph = this.graph;
    const dim = this.style.display.dimUnselected && this.selectedCount > 0;
    graph?.style.write(this.device, this.style, graph.styled, dim);
  }

  /** Where `x, y` per point, relative to the view's origin, are read from. */
  get positionBuffer(): GPUBuffer | undefined {
    return this.graph?.positions;
  }

  get drawn(): Drawn | undefined {
    return this.graph;
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
    const changed = count > 0 !== this.selectedCount > 0;
    this.selectedCount = count;
    if (changed) this.writeStyle();
  }

  /** Finds what is in view; runs before the render pass that draws it. */
  cull(encoder: GPUCommandEncoder, view: View): void {
    const graph = this.graph;
    if (!graph || (!graph.pieceCull && !graph.links)) return;
    const worldPerPixel = 1 / view.zoom;
    const { widthByDepth, double } = this.style.display;
    const widest = (widthByDepth ? MAX_RIBBON_WIDTH / 2 : view.ribbonHalf) + (double ? STRAND_SHIFT : 0);
    const ribbonHalf = Math.max(widest, worldPerPixel / 2);
    const area: CullView = {
      centerX: view.centerX,
      centerY: view.centerY,
      halfWidth: view.width / 2 / view.zoom,
      halfHeight: view.height / 2 / view.zoom,
      pad: ribbonHalf + view.outlineWidth + 2 * worldPerPixel,
      ribbonHalf: view.ribbonHalf,
      hover: view.hover,
      spriteWorld: this.style.display.spritePx * worldPerPixel,
    };
    const pass = encoder.beginComputePass({ label: 'cull' });
    graph.pieceCull?.encode(this.device, pass, area);
    if (view.linkAlpha > 0) graph.links?.encode(this.device, pass, area);
    if (this.highlighting(view)) graph.highlight?.encode(this.device, pass, area);
    pass.end();
  }

  draw(pass: GPURenderPassEncoder, view: View): void {
    const graph = this.graph;
    if (!graph) return;
    // Links first, so ribbons cover their ends, as in Bandage.
    if (view.linkAlpha > 0 && graph.links) {
      this.eachStrand(pass, 'graph', view, 0, this.link, 0);
    }
    if (!graph.pieceCull) return;
    this.eachStrand(pass, 'graph', view, 0, this.ribbon, PIECES_INDIRECT);
    if (!this.highlighting(view)) return;
    this.eachStrand(pass, 'outline', view, view.outlineWidth / 2, this.outline, HIGHLIGHT_INDIRECT);
    this.eachStrand(pass, 'fill', view, -view.outlineWidth / 2, this.ribbon, HIGHLIGHT_INDIRECT);
  }

  /** Segment ids of the ribbons in view, into an `ID_FORMAT` target; reuses the last cull. */
  drawIds(pass: GPURenderPassEncoder, view: View): void {
    if (!this.graph?.pieceCull) return;
    this.eachStrand(pass, 'ids', view, 0, this.ribbonIds, PIECES_INDIRECT);
  }

  /** Draws once in single mode and once per strand in double mode. */
  private eachStrand(
    pass: GPURenderPassEncoder,
    kind: Pass,
    view: View,
    grow: number,
    pipeline: GPURenderPipeline,
    indirect: number,
  ): void {
    const graph = this.graph;
    if (!graph) return;
    pass.setPipeline(pipeline);
    (this.style.display.double ? DOUBLE : SINGLE).forEach((strand, k) => {
      this.writeView(kind, k, view, grow, strand);
      const group = graph.groups[kind][k];
      if (!group) return;
      pass.setBindGroup(0, group);
      pass.drawIndirect(graph.indirect, indirect);
    });
  }

  private highlighting(view: View): boolean {
    return this.selectedCount > 0 || view.hover !== undefined;
  }

  private writeView(pass: Pass, k: number, view: View, grow: number, strand: number): void {
    packView(this.viewData, view, grow, strand);
    const buffer = this.views[pass][k];
    if (buffer) this.device.queue.writeBuffer(buffer, 0, this.viewData);
  }

  destroy(): void {
    this.graph?.buffers.destroy();
    this.graph = undefined;
    for (const view of Object.values(this.views).flat()) view.destroy();
  }
}
