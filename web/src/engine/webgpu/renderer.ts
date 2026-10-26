import type { Geometry } from '../../workers/protocol/layout';
import { Cull, type CullView } from './cull';
import { Buffers } from './layout/gpu';
import type { Kernels } from './layout/kernels';
import type { Rgba } from '../style/palette';
import shader from './shaders/graph.wgsl?raw';

/** Matches `View` in graph.wgsl: 12 floats. */
const VIEW_BYTES = 48;
const LINK_STEPS = 16;
/** `vertexCount, instanceCount, firstVertex, firstInstance` for links, then pieces. */
const INDIRECT = [LINK_STEPS * 6, 0, 0, 0, 6, 0, 0, 0];
const PIECES_INDIRECT = 16;

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
}

interface Graph {
  buffers: Buffers;
  positions: GPUBuffer;
  bindGroup: GPUBindGroup;
  indirect: GPUBuffer;
  pieces: Cull | undefined;
  links: Cull | undefined;
}

/**
 * Draws ribbons and links instanced over the pieces and links a compute pass
 * finds in view, so a zoomed-in view only pays for what it shows.
 */
export class Renderer {
  private readonly ribbon: GPURenderPipeline;
  private readonly link: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly view: GPUBuffer;
  private readonly viewData = new Float32Array(VIEW_BYTES / 4);
  private graph: Graph | undefined;

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
    const pipeline = (name: string) =>
      device.createRenderPipeline({
        label: name,
        layout: pipelineLayout,
        vertex: { module, entryPoint: `${name}_vertex` },
        fragment: { module, entryPoint: `${name}_fragment`, targets: [{ format, blend }] },
        primitive: { topology: 'triangle-list' },
      });
    this.ribbon = pipeline('ribbon');
    this.link = pipeline('link');
    this.view = device.createBuffer({
      label: 'view',
      size: VIEW_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  setGeometry(geometry: Geometry, colors: Uint32Array<ArrayBuffer>): void {
    this.graph?.buffers.destroy();
    const b = new Buffers(this.device);
    const pieceCount = geometry.pieces.length / 2;
    const linkCount = geometry.links.length / 4;
    const positions = b.storage('positions', geometry.points * 8);
    const pieces = b.upload('pieces', geometry.pieces);
    const links = b.upload('links', geometry.links);
    const indirect = b.upload('draw arguments', Uint32Array.from(INDIRECT), GPUBufferUsage.INDIRECT);
    const cull = (kind: 'pieces' | 'links', count: number, items: GPUBuffer, slot: number) =>
      count > 0 ? new Cull(this.kernels, b, kind, count, positions, items, indirect, slot) : undefined;
    const pieceCull = cull('pieces', pieceCount, pieces, PIECES_INDIRECT / 4 + 1);
    const linkCull = cull('links', linkCount, links, 1);
    const empty = b.storage('empty', 4);
    this.graph = {
      buffers: b,
      positions,
      indirect,
      pieces: pieceCull,
      links: linkCull,
      bindGroup: this.device.createBindGroup({
        label: 'graph',
        layout: this.layout,
        entries: [
          this.view,
          positions,
          pieces,
          b.upload('colors', colors),
          links,
          linkCull?.visible ?? empty,
          pieceCull?.visible ?? empty,
        ].map((buffer, binding) => ({ binding, resource: { buffer } })),
      }),
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
      pad: ribbonHalf + 2 * worldPerPixel,
      ribbonHalf: view.ribbonHalf,
    };
    const pass = encoder.beginComputePass({ label: 'cull' });
    graph.pieces?.encode(this.device, pass, area);
    if (view.linkAlpha > 0) graph.links?.encode(this.device, pass, area);
    pass.end();
  }

  draw(pass: GPURenderPassEncoder, view: View): void {
    const graph = this.graph;
    if (!graph) return;
    const d = this.viewData;
    d.set([
      view.centerX,
      view.centerY,
      (view.zoom * 2) / view.width,
      (-view.zoom * 2) / view.height,
      1 / view.zoom,
      view.ribbonHalf,
      view.linkHalf,
      view.linkAlpha,
      ...view.linkColor,
    ]);
    this.device.queue.writeBuffer(this.view, 0, d);
    pass.setBindGroup(0, graph.bindGroup);
    // Links first, so ribbons cover their ends, as in Bandage.
    if (view.linkAlpha > 0 && graph.links) {
      pass.setPipeline(this.link);
      pass.drawIndirect(graph.indirect, 0);
    }
    if (graph.pieces) {
      pass.setPipeline(this.ribbon);
      pass.drawIndirect(graph.indirect, PIECES_INDIRECT);
    }
  }

  destroy(): void {
    this.graph?.buffers.destroy();
    this.graph = undefined;
    this.view.destroy();
  }
}
