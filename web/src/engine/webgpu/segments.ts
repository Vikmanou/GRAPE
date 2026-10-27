import type { Geometry } from '../../workers/protocol/layout';
import type { SegmentData, Style } from '../core/backend';
import { mix, NO_TAG_COLOR, UNIFORM_COLOR } from '../style/colors';
import { COLOR_MODES } from '../style/display';
import { packRgba, palettes } from '../style/palette';
import { ramp, RAMP_SIZE } from '../style/ramps';
import type { Buffers } from './layout/gpu';

/** The fields of graph.wgsl's segment table, each a run of one u32 per segment. */
const FIELDS = ['depth', 'gc', 'length', 'component', 'tag', 'tag2', 'start', 'pieces'] as const;

/** Matches `Style` in graph.wgsl: 16 words, then the ramp. */
const HEADER_WORDS = 16;
const STYLE_WORDS = HEADER_WORDS + RAMP_SIZE;

function dense(segments: number, tags: SegmentData['tagColors']): Uint32Array<ArrayBuffer> {
  const out = new Uint32Array(segments);
  tags.segments.forEach((segment, i) => {
    out[segment] = tags.colors[i] ?? 0;
  });
  return out;
}

/**
 * Every per-segment value the shaders read, in one buffer of `FIELDS` runs:
 * one storage binding however many fields there are, and each run is written
 * straight from its typed array.
 */
export function uploadSegments(buffers: Buffers, geometry: Geometry, data: SegmentData): GPUBuffer {
  const n = geometry.segments;
  const runs: Record<(typeof FIELDS)[number], ArrayBufferView> = {
    depth: data.depth,
    gc: data.gc,
    length: data.lengths,
    component: data.components,
    tag: dense(n, data.tagColors),
    tag2: dense(n, data.tagColors2),
    start: geometry.segmentStarts,
    pieces: Uint32Array.from(geometry.segmentPieces),
  };
  const buffer = buffers.storage('segments', Math.max(4, FIELDS.length * n * 4));
  FIELDS.forEach((field, i) => {
    const run = runs[field];
    buffers.device.queue.writeBuffer(buffer, i * n * 4, run.buffer, run.byteOffset, Math.min(run.byteLength, n * 4));
  });
  return buffer;
}

export interface StyledGraph {
  segments: number;
  seed: number;
  meanDepth: number;
}

/** How graph.wgsl colours and sizes segments; one write changes it all. */
export class StyleUniform {
  readonly buffer: GPUBuffer;
  private readonly data = new ArrayBuffer(STYLE_WORDS * 4);

  constructor(buffers: Buffers) {
    this.buffer = buffers.uniform('style', this.data);
  }

  /** `dim` when unselected segments should fade now. */
  write(device: GPUDevice, style: Style, graph: StyledGraph, dim: boolean): void {
    const { display } = style;
    const log = display.range.scale === 'log';
    const along = (v: number) => (log ? Math.log(Math.max(v, 1e-30)) : v);
    const u = new Uint32Array(this.data);
    const f = new Float32Array(this.data);
    u[0] = COLOR_MODES.indexOf(display.color);
    u[1] = log ? 1 : 0;
    f[2] = along(display.range.min);
    f[3] = along(display.range.max);
    u[4] = mix(graph.seed);
    u[5] = graph.segments;
    u[6] = display.widthByDepth ? 1 : 0;
    f[7] = graph.meanDepth;
    u[8] = UNIFORM_COLOR;
    u[9] = packRgba(palettes[style.theme].unknown);
    u[10] = NO_TAG_COLOR;
    u[11] = dim ? 1 : 0;
    f[12] = display.spritePx;
    u.set(ramp, HEADER_WORDS);
    device.queue.writeBuffer(this.buffer, 0, this.data);
  }
}
