/** Data textures are this many texels wide; `texel` in common.glsl matches. */
export const TEXTURE_WIDTH = 4096;

const PREAMBLE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp usampler2D;
`;

/** Binding points of the shaders' uniform blocks. */
export const VIEW_BLOCK = 0;
export const STYLE_BLOCK = 1;

export interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`shader failed to compile: ${log}`);
  }
  return shader;
}

/** Links a program from sources that follow the preamble, `common` prepended to both stages. */
export function createProgram(
  gl: WebGL2RenderingContext,
  common: string,
  vertex: string,
  fragment: string,
  samplers: string[],
): Program {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, PREAMBLE + common + vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, PREAMBLE + common + fragment);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'item');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`program failed to link: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  const blocks: [string, number][] = [
    ['ViewBlock', VIEW_BLOCK],
    ['StyleBlock', STYLE_BLOCK],
  ];
  for (const [name, binding] of blocks) {
    const index = gl.getUniformBlockIndex(program, name);
    if (index !== gl.INVALID_INDEX) gl.uniformBlockBinding(program, index, binding);
  }
  const locations = new Map<string, WebGLUniformLocation | null>();
  const uniform = (name: string) => {
    if (!locations.has(name)) locations.set(name, gl.getUniformLocation(program, name));
    return locations.get(name) ?? null;
  };
  gl.useProgram(program);
  samplers.forEach((name, unit) => {
    gl.uniform1i(uniform(name), unit);
  });
  return { program, uniform };
}

/** The texture formats data arrays are stored in: components per item, and their GL names. */
const COMPONENTS = { r32ui: 1, rg32ui: 2, rgba32ui: 4, rg32f: 2 } as const;

function layoutOf(gl: WebGL2RenderingContext, format: Format): { internal: number; format: number } {
  switch (format) {
    case 'r32ui':
      return { internal: gl.R32UI, format: gl.RED_INTEGER };
    case 'rg32ui':
      return { internal: gl.RG32UI, format: gl.RG_INTEGER };
    case 'rgba32ui':
      return { internal: gl.RGBA32UI, format: gl.RGBA_INTEGER };
    case 'rg32f':
      return { internal: gl.RG32F, format: gl.RG };
  }
}

export type Format = keyof typeof COMPONENTS;

/** Creates and frees GL objects, counting the bytes they hold. */
export class Resources {
  private readonly sizes = new Map<WebGLTexture | WebGLBuffer, number>();
  private total = 0;

  constructor(readonly gl: WebGL2RenderingContext) {}

  get bytes(): number {
    return this.total;
  }

  /** A texture of `count` items `TEXTURE_WIDTH` wide, 4 bytes per component. */
  dataTexture(format: Format, count: number): WebGLTexture {
    const gl = this.gl;
    const rows = Math.max(1, Math.ceil(count / TEXTURE_WIDTH));
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, layoutOf(gl, format).internal, TEXTURE_WIDTH, rows);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    this.track(texture, TEXTURE_WIDTH * rows * COMPONENTS[format] * 4);
    return texture;
  }

  /** Writes items `0..` of `data` into a data texture, whole rows first, then the rest of the last. */
  writeData(texture: WebGLTexture, format: Format, data: Uint32Array | Float32Array): void {
    const gl = this.gl;
    const layout = layoutOf(gl, format).format;
    const components = COMPONENTS[format];
    const type = data instanceof Float32Array ? gl.FLOAT : gl.UNSIGNED_INT;
    const count = Math.floor(data.length / components);
    const rows = Math.floor(count / TEXTURE_WIDTH);
    const rest = count - rows * TEXTURE_WIDTH;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    if (rows > 0) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, TEXTURE_WIDTH, rows, layout, type, data, 0);
    if (rest > 0) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, rows, rest, 1, layout, type, data, rows * TEXTURE_WIDTH * components);
    }
  }

  buffer(target: number, bytes: number, usage: number): WebGLBuffer {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, Math.max(4, bytes), usage);
    this.track(buffer, bytes);
    return buffer;
  }

  /** Counts `bytes` for `object`, replacing what it held before. */
  track(object: WebGLTexture | WebGLBuffer, bytes: number): void {
    this.total += bytes - (this.sizes.get(object) ?? 0);
    this.sizes.set(object, bytes);
  }

  release(object: WebGLTexture | WebGLBuffer | undefined): void {
    if (!object) return;
    const gl = this.gl;
    this.total -= this.sizes.get(object) ?? 0;
    this.sizes.delete(object);
    if (object instanceof WebGLTexture) gl.deleteTexture(object);
    else gl.deleteBuffer(object);
  }

  destroy(): void {
    for (const object of [...this.sizes.keys()]) this.release(object);
  }
}
