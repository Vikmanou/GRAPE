import type { Geometry, PositionGrid } from '../../workers/protocol/layout';
import type { SegmentData, Style } from '../core/backend';
import type { Hidden } from '../core/Visibility';
import { DEFAULT_DISPLAY } from '../style/display';
import {
  type DrawnView,
  FIELDS,
  packStyle,
  packView,
  segmentRuns,
  STYLE_BYTES,
  type StyledGraph,
  VIEW_BYTES,
} from '../style/uniforms';
import { createProgram, type Program, Resources, STYLE_BLOCK, VIEW_BLOCK } from './context';
import common from './shaders/common.glsl?raw';
import inside from './shaders/inside.glsl?raw';
import linkFragment from './shaders/link.frag?raw';
import linkVertex from './shaders/link.vert?raw';
import ribbonFragment from './shaders/ribbon.frag?raw';
import ribbonIdFragment from './shaders/ribbonId.frag?raw';
import ribbonVertex from './shaders/ribbon.vert?raw';
import { firstPieces, type ItemList, Visible } from './visible';

const SAMPLERS = ['positions', 'pieces', 'segment_table', 'links', 'selected'];
const LINK_STEPS = 16;
/** `strand` in the view block: 0 draws single mode, 1 and -1 the two strands of double mode. */
const SINGLE = [0];
const DOUBLE = [1, -1];

interface Graph {
  styled: StyledGraph;
  pieceCount: number;
  linkCount: number;
  /** In the order of `SAMPLERS`. */
  textures: WebGLTexture[];
  /** What the segment table texture holds. */
  table: Uint32Array;
  /** `x, y` per point relative to the view's origin; queries read it. */
  positions: Float32Array;
  geometry: Geometry;
  firstPiece: Uint32Array;
  visible: Visible;
  /** One bit per selected segment, then per hidden segment, then per hidden link. */
  flags: Uint32Array;
  selected: Uint32Array;
  grid: PositionGrid | undefined;
}

/** What one frame draws, found on the CPU before drawing. */
interface Lists {
  pieces: ItemList;
  links: ItemList | undefined;
  lit: ItemList | undefined;
}

/**
 * Draws ribbons and links instanced, as the WebGPU renderer does, over the
 * pieces and links the CPU finds in view through the layout worker's grid.
 */
export class Renderer {
  private readonly ribbon: Program;
  private readonly ribbonIds: Program;
  private readonly link: Program;
  private readonly vao: WebGLVertexArrayObject;
  private readonly items: WebGLBuffer;
  private itemCapacity = 0;
  private readonly viewBlock: WebGLBuffer;
  private readonly styleBlock: WebGLBuffer;
  private readonly viewData = new ArrayBuffer(VIEW_BYTES);
  private readonly styleData = new ArrayBuffer(STYLE_BYTES);
  private graph: Graph | undefined;
  private selectedCount = 0;
  private style: Style = { theme: 'light', display: DEFAULT_DISPLAY };

  constructor(private readonly res: Resources) {
    const gl = res.gl;
    const program = (vertex: string, fragment: string) => createProgram(gl, common, vertex, fragment, SAMPLERS);
    this.ribbon = program(ribbonVertex, inside + ribbonFragment);
    this.ribbonIds = program(ribbonVertex, inside + ribbonIdFragment);
    this.link = program(linkVertex, linkFragment);
    this.vao = gl.createVertexArray();
    this.items = gl.createBuffer();
    this.viewBlock = res.buffer(gl.UNIFORM_BUFFER, VIEW_BYTES, gl.DYNAMIC_DRAW);
    this.styleBlock = res.buffer(gl.UNIFORM_BUFFER, STYLE_BYTES, gl.DYNAMIC_DRAW);
  }

  setGeometry(geometry: Geometry, data: SegmentData, seed: number): void {
    this.releaseGraph();
    const res = this.res;
    const n = geometry.segments;
    const tableData = new Uint32Array(Math.max(1, FIELDS.length * n));
    segmentRuns(geometry, data).forEach((run, i) => {
      tableData.set(new Uint32Array(run.buffer, run.byteOffset, Math.min(n, run.byteLength / 4)), i * n);
    });
    const positions = res.dataTexture('rg32f', geometry.points);
    const pieces = res.dataTexture('rg32ui', geometry.pieces.length / 2);
    const table = res.dataTexture('r32ui', tableData.length);
    const links = res.dataTexture('rgba32ui', geometry.links.length / 4);
    const words = Math.ceil(n / 32);
    const flags = new Uint32Array(2 * words + Math.ceil(geometry.links.length / 4 / 32));
    const selected = res.dataTexture('r32ui', Math.max(1, flags.length));
    res.writeData(pieces, 'rg32ui', geometry.pieces);
    res.writeData(table, 'r32ui', tableData);
    res.writeData(links, 'rgba32ui', geometry.links);
    const pieceCount = geometry.pieces.length / 2;
    const linkCount = geometry.links.length / 4;
    const relative = new Float32Array(geometry.points * 2);
    const firstPiece = firstPieces(geometry.segmentPieces);
    const g = { positions: relative, pieces: geometry.pieces, links: geometry.links };
    this.graph = {
      styled: { segments: n, seed, meanDepth: data.meanDepth },
      pieceCount,
      linkCount,
      textures: [positions, pieces, table, links, selected],
      table: tableData,
      positions: relative,
      geometry,
      firstPiece,
      visible: new Visible(g, firstPiece, pieceCount, linkCount),
      flags,
      selected: flags.subarray(0, words),
      grid: undefined,
    };
    this.selectedCount = 0;
    res.writeData(selected, 'r32ui', flags);
    this.ensureItems(Math.max(pieceCount, linkCount));
    this.writeStyle();
  }

  get current(): Graph | undefined {
    return this.graph;
  }

  setStyle(style: Style): void {
    this.style = style;
    this.writeStyle();
  }

  /** `x, y` per point relative to the view's origin, and the grid over them in the same frame. */
  setPositions(positions: Float32Array<ArrayBuffer>, grid: PositionGrid | undefined): void {
    const graph = this.graph;
    if (!graph) return;
    graph.positions.set(positions.subarray(0, graph.positions.length));
    graph.grid = grid;
    const texture = graph.textures[0];
    if (texture) this.res.writeData(texture, 'rg32f', graph.positions);
  }

  setSelection(bits: Uint32Array<ArrayBuffer>, count: number): void {
    const graph = this.graph;
    if (!graph) return;
    graph.selected.fill(0);
    graph.selected.set(bits.subarray(0, graph.selected.length));
    const texture = graph.textures[4];
    if (texture) this.res.writeItems(texture, 'r32ui', graph.flags, 0, graph.selected.length);
    const changed = count > 0 !== this.selectedCount > 0;
    this.selectedCount = count;
    if (changed) this.writeStyle();
  }

  setVisibility(hidden: Hidden): void {
    const graph = this.graph;
    const texture = graph?.textures[4];
    const words = graph?.selected.length ?? 0;
    if (!graph || !texture || hidden.segments.length !== words) return;
    graph.flags.set(hidden.segments, words);
    graph.flags.set(hidden.links.subarray(0, graph.flags.length - 2 * words), 2 * words);
    this.res.writeItems(texture, 'r32ui', graph.flags, words, graph.flags.length);
  }

  setPathColors(colors: Uint32Array): void {
    const graph = this.graph;
    const texture = graph?.textures[2];
    const n = graph?.styled.segments ?? 0;
    if (!graph || !texture || colors.length !== n) return;
    const start = FIELDS.indexOf('path') * n;
    graph.table.set(colors, start);
    this.res.writeItems(texture, 'r32ui', graph.table, start, start + n);
  }

  draw(view: DrawnView): void {
    const graph = this.graph;
    if (!graph) return;
    const gl = this.res.gl;
    const lists = this.lists(graph, view);
    gl.enable(gl.BLEND);
    // Shaders output premultiplied alpha.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // Links first, so ribbons cover their ends, as in Bandage.
    if (lists.links) this.eachStrand(this.link, view, 0, lists.links, LINK_STEPS * 6, graph.linkCount);
    this.eachStrand(this.ribbon, view, 0, lists.pieces, 6, graph.pieceCount, false);
    if (lists.lit) {
      this.eachStrand(this.ribbon, view, view.outlineWidth / 2, lists.lit, 6, graph.pieceCount, true);
      this.eachStrand(this.ribbon, view, -view.outlineWidth / 2, lists.lit, 6, graph.pieceCount, false);
    }
    gl.disable(gl.BLEND);
  }

  /** Segment ids of the ribbons in view, into the bound integer target. */
  drawIds(view: DrawnView): void {
    const graph = this.graph;
    if (!graph) return;
    const area = Visible.area(view, this.style.display);
    this.eachStrand(this.ribbonIds, view, 0, graph.visible.pieces(graph.grid, area), 6, graph.pieceCount);
  }

  private lists(graph: Graph, view: DrawnView): Lists {
    const area = Visible.area(view, this.style.display);
    const lit = this.selectedCount > 0 || view.hover !== undefined;
    return {
      pieces: graph.visible.pieces(graph.grid, area),
      links:
        view.linkAlpha > 0 && graph.linkCount > 0 ? graph.visible.links(graph.grid, area, view.ribbonHalf) : undefined,
      lit: lit ? graph.visible.highlighted(graph.selected, view.hover, area) : undefined,
    };
  }

  /** Draws once in single mode and once per strand in double mode. */
  private eachStrand(
    program: Program,
    view: DrawnView,
    grow: number,
    list: ItemList,
    vertices: number,
    total: number,
    outlined?: boolean,
  ): void {
    const gl = this.res.gl;
    const graph = this.graph;
    const instances = list.every ? total : list.count;
    if (!graph || instances === 0) return;
    gl.useProgram(program.program);
    graph.textures.forEach((texture, unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    });
    gl.uniform1i(program.uniform('every_item'), list.every ? 1 : 0);
    if (outlined !== undefined) gl.uniform1i(program.uniform('outlined'), outlined ? 1 : 0);
    gl.bindVertexArray(this.vao);
    if (list.every) {
      gl.disableVertexAttribArray(0);
      gl.vertexAttribI4ui(0, 0, 0, 0, 0);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.items);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, list.items, 0, list.count);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 4, 0);
      gl.vertexAttribDivisor(0, 1);
    }
    gl.bindBufferBase(gl.UNIFORM_BUFFER, STYLE_BLOCK, this.styleBlock);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, VIEW_BLOCK, this.viewBlock);
    for (const strand of this.style.display.double ? DOUBLE : SINGLE) {
      packView(this.viewData, view, grow, strand);
      gl.bindBuffer(gl.UNIFORM_BUFFER, this.viewBlock);
      gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.viewData);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, vertices, instances);
    }
    gl.bindVertexArray(null);
  }

  private ensureItems(count: number): void {
    if (count <= this.itemCapacity) return;
    const gl = this.res.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.items);
    gl.bufferData(gl.ARRAY_BUFFER, Math.max(4, count * 4), gl.DYNAMIC_DRAW);
    this.res.track(this.items, count * 4);
    this.itemCapacity = count;
  }

  private writeStyle(): void {
    const graph = this.graph;
    if (!graph) return;
    const dim = this.style.display.dimUnselected && this.selectedCount > 0;
    packStyle(this.styleData, this.style, graph.styled, dim);
    const gl = this.res.gl;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.styleBlock);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, this.styleData);
  }

  private releaseGraph(): void {
    for (const texture of this.graph?.textures ?? []) this.res.release(texture);
    this.graph = undefined;
  }

  destroy(): void {
    this.releaseGraph();
    const gl = this.res.gl;
    gl.deleteVertexArray(this.vao);
    for (const p of [this.ribbon, this.ribbonIds, this.link]) gl.deleteProgram(p.program);
  }
}
