import type { View } from '../core/backend';
import type { Atlas } from '../text/Atlas';
import { GLYPH_FLOATS } from '../text/layoutLabels';
import type { TextStyle } from '../webgpu/glyphs';
import { createProgram, type Program, type Resources } from './context';
import fragment from './shaders/glyph.frag?raw';
import vertex from './shaders/glyph.vert?raw';

/** Where anchors are read from: the renderer's position and segment table textures. */
export interface GlyphSource {
  positions: WebGLTexture;
  table: WebGLTexture;
  segments: number;
}

/** Draws label glyphs from the atlas, over the graph. */
export class GlyphRenderer {
  private readonly program: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly glyphs: WebGLBuffer;
  private atlasTexture: WebGLTexture | undefined;
  private atlas: Atlas | undefined;
  private count = 0;
  private source: GlyphSource | undefined;

  constructor(private readonly res: Resources) {
    const gl = res.gl;
    this.program = createProgram(gl, '', vertex, fragment, ['positions', 'segment_table', 'atlas']);
    this.vao = gl.createVertexArray();
    this.glyphs = gl.createBuffer();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphs);
    const stride = GLYPH_FLOATS * 4;
    const attribute = (name: string, size: number, offset: number) => {
      const location = gl.getAttribLocation(this.program.program, name);
      if (location < 0) return;
      gl.enableVertexAttribArray(location);
      if (name === 'segment') gl.vertexAttribIPointer(location, size, gl.UNSIGNED_INT, stride, offset);
      else gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset);
      gl.vertexAttribDivisor(location, 1);
    };
    attribute('offset', 2, 0);
    attribute('size', 2, 8);
    attribute('uv_box', 4, 16);
    attribute('segment', 1, 32);
    gl.bindVertexArray(null);
  }

  setAtlas(atlas: Atlas): void {
    const gl = this.res.gl;
    this.res.release(this.atlasTexture);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, atlas.image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.res.track(texture, atlas.image.width * atlas.image.height * 4);
    this.atlasTexture = texture;
    this.atlas = atlas;
  }

  /** A new graph brings new textures, and drops the glyphs of the last. */
  setSource(source: GlyphSource | undefined): void {
    this.source = source;
    this.setGlyphs(new Float32Array(0));
  }

  setGlyphs(glyphs: Float32Array<ArrayBuffer>): void {
    const gl = this.res.gl;
    this.count = glyphs.length / GLYPH_FLOATS;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glyphs);
    gl.bufferData(gl.ARRAY_BUFFER, glyphs, gl.DYNAMIC_DRAW);
    this.res.track(this.glyphs, glyphs.byteLength);
  }

  draw(view: View, style: TextStyle, fontPx: number): void {
    const { atlas, atlasTexture, source } = this;
    if (!atlas || !atlasTexture || !source || this.count === 0) return;
    const gl = this.res.gl;
    const p = this.program;
    gl.useProgram(p.program);
    gl.uniform2f(p.uniform('center'), view.centerX, view.centerY);
    gl.uniform1f(p.uniform('zoom'), view.zoom);
    gl.uniform2f(p.uniform('canvas'), view.width, view.height);
    gl.uniform1ui(p.uniform('segments'), source.segments);
    gl.uniform1f(p.uniform('px_range'), (atlas.metrics.distanceRange * fontPx) / atlas.metrics.size);
    gl.uniform4fv(p.uniform('color'), style.color);
    gl.uniform4fv(p.uniform('halo'), style.halo);
    [source.positions, source.table, atlasTexture].forEach((texture, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }

  destroy(): void {
    const gl = this.res.gl;
    this.res.release(this.atlasTexture);
    this.res.release(this.glyphs);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program.program);
  }
}
