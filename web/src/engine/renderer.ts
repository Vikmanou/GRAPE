import type { Geometry } from '../workers/protocol';
import type { Rgba } from './palette';
import shader from './shaders/graph.wgsl?raw';

/** Matches `View` in graph.wgsl: 12 floats. */
const VIEW_BYTES = 48;
const LINK_STEPS = 16;

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

export class Renderer {
  private readonly ribbon: GPURenderPipeline;
  private readonly link: GPURenderPipeline;
  private readonly layout: GPUBindGroupLayout;
  private readonly view: GPUBuffer;
  private readonly viewData = new Float32Array(VIEW_BYTES / 4);
  private buffers: GPUBuffer[] = [];
  private positions: GPUBuffer | undefined;
  private bindGroup: GPUBindGroup | undefined;
  private pieceCount = 0;
  private linkCount = 0;

  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
  ) {
    const module = device.createShaderModule({ label: 'graph', code: shader });
    const visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
    const storage = { type: 'read-only-storage' } as const;
    this.layout = device.createBindGroupLayout({
      label: 'graph',
      entries: [
        { binding: 0, visibility, buffer: { type: 'uniform' } },
        ...[1, 2, 3, 4].map((binding) => ({ binding, visibility, buffer: storage })),
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

  setGeometry(geometry: Geometry, colors: Uint32Array): void {
    this.release();
    this.pieceCount = geometry.pieces.length / 2;
    this.linkCount = geometry.links.length / 4;
    this.positions = this.storage('positions', geometry.points * 8);
    const pieces = this.upload('pieces', geometry.pieces);
    const segmentColors = this.upload('colors', colors);
    const links = this.upload('links', geometry.links);
    this.bindGroup = this.device.createBindGroup({
      label: 'graph',
      layout: this.layout,
      entries: [this.view, this.positions, pieces, segmentColors, links].map((buffer, binding) => ({
        binding,
        resource: { buffer },
      })),
    });
  }

  /** Where `x, y` per point, relative to the view's origin, are read from. */
  get positionBuffer(): GPUBuffer | undefined {
    return this.positions;
  }

  /** `x, y` per point, relative to the same origin as the view's centre. */
  setPositions(positions: Float32Array<ArrayBuffer>): void {
    if (this.positions && positions.byteLength <= this.positions.size) {
      this.device.queue.writeBuffer(this.positions, 0, positions);
    }
  }

  draw(pass: GPURenderPassEncoder, view: View): void {
    if (!this.bindGroup) return;
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
    pass.setBindGroup(0, this.bindGroup);
    // Links first, so ribbons cover their ends, as in Bandage.
    if (view.linkAlpha > 0 && this.linkCount > 0) {
      pass.setPipeline(this.link);
      pass.draw(LINK_STEPS * 6, this.linkCount);
    }
    if (this.pieceCount > 0) {
      pass.setPipeline(this.ribbon);
      pass.draw(6, this.pieceCount);
    }
  }

  destroy(): void {
    this.release();
    this.view.destroy();
  }

  private release(): void {
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers = [];
    this.positions = undefined;
    this.bindGroup = undefined;
  }

  /** Storage bindings cannot be empty, so every buffer holds at least 16 bytes. */
  private storage(label: string, bytes: number): GPUBuffer {
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(16, Math.ceil(bytes / 4) * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.buffers.push(buffer);
    return buffer;
  }

  // Typed arrays here never sit on a SharedArrayBuffer: the app runs without
  // cross-origin isolation, where those cannot be created.
  private upload(label: string, data: Uint32Array): GPUBuffer {
    const buffer = this.storage(label, data.byteLength);
    if (data.byteLength > 0) this.device.queue.writeBuffer(buffer, 0, data as Uint32Array<ArrayBuffer>);
    return buffer;
  }
}
