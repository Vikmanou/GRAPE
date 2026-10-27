import type { View } from '../core/backend';
import type { Rgba } from '../style/palette';
import type { Atlas } from '../text/Atlas';
import { GLYPH_FLOATS } from '../text/layoutLabels';
import type { Buffers } from './layout/gpu';
import shader from './shaders/glyphs.wgsl?raw';

/** Matches `Text` in glyphs.wgsl. */
const TEXT_BYTES = 64;

export interface TextStyle {
  color: Rgba;
  halo: Rgba;
}

/** Draws label glyphs from the atlas, over the graph. */
export class GlyphRenderer {
  private readonly pipeline: GPURenderPipeline;
  private readonly uniform: GPUBuffer;
  private readonly data = new ArrayBuffer(TEXT_BYTES);
  private readonly sampler: GPUSampler;
  private texture: GPUTexture | undefined;
  private atlas: Atlas | undefined;
  private glyphs: GPUBuffer | undefined;
  private count = 0;
  private group: GPUBindGroup | undefined;
  private source: { positions: GPUBuffer; table: GPUBuffer; segments: number } | undefined;

  constructor(
    private readonly device: GPUDevice,
    format: GPUTextureFormat,
    private readonly buffers: Buffers,
  ) {
    const module = device.createShaderModule({ label: 'glyphs', code: shader });
    const blend: GPUBlendState = {
      color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
      alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
    };
    this.pipeline = device.createRenderPipeline({
      label: 'glyphs',
      layout: 'auto',
      vertex: { module, entryPoint: 'glyph_vertex' },
      fragment: { module, entryPoint: 'glyph_fragment', targets: [{ format, blend }] },
      primitive: { topology: 'triangle-list' },
    });
    this.uniform = buffers.uniform('text', this.data);
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  }

  setAtlas(atlas: Atlas): void {
    const { image } = atlas;
    this.texture?.destroy();
    this.texture = this.device.createTexture({
      label: 'label atlas',
      size: [image.width, image.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture({ source: image }, { texture: this.texture }, [
      image.width,
      image.height,
    ]);
    this.atlas = atlas;
    this.group = undefined;
  }

  /** Where anchors are read from; a new graph brings new buffers. */
  setSource(source: { positions: GPUBuffer; table: GPUBuffer; segments: number } | undefined): void {
    this.source = source;
    this.setGlyphs(new Float32Array(0));
  }

  setGlyphs(glyphs: Float32Array<ArrayBuffer>): void {
    this.buffers.release(this.glyphs);
    this.count = glyphs.length / GLYPH_FLOATS;
    this.glyphs = this.count > 0 ? this.buffers.upload('glyphs', glyphs) : undefined;
    this.group = undefined;
  }

  draw(pass: GPURenderPassEncoder, view: View, style: TextStyle, fontPx: number): void {
    const { atlas, texture, glyphs, source } = this;
    if (!atlas || !texture || !glyphs || !source || this.count === 0) return;
    const f = new Float32Array(this.data);
    f.set([view.centerX, view.centerY, view.zoom, (atlas.metrics.distanceRange * fontPx) / atlas.metrics.size]);
    f.set([view.width, view.height], 4);
    new Uint32Array(this.data)[6] = source.segments;
    f.set([...style.color, ...style.halo], 8);
    this.device.queue.writeBuffer(this.uniform, 0, this.data);
    this.group ??= this.device.createBindGroup({
      label: 'glyphs',
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.uniform } },
        { binding: 1, resource: { buffer: source.positions } },
        { binding: 2, resource: { buffer: source.table } },
        { binding: 3, resource: { buffer: glyphs } },
        { binding: 4, resource: texture.createView() },
        { binding: 5, resource: this.sampler },
      ],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.group);
    pass.draw(6, this.count);
  }

  destroy(): void {
    this.texture?.destroy();
  }
}
