import type { Geometry } from '../../workers/protocol/layout';
import type { SegmentData, Style } from '../core/backend';
import { FIELDS, packStyle, segmentRuns, STYLE_BYTES, type StyledGraph } from '../style/uniforms';
import type { Buffers } from './layout/gpu';

/**
 * Every per-segment value the shaders read, in one buffer of `FIELDS` runs:
 * one storage binding however many fields there are, and each run is written
 * straight from its typed array.
 */
export function uploadSegments(buffers: Buffers, geometry: Geometry, data: SegmentData): GPUBuffer {
  const n = geometry.segments;
  const buffer = buffers.storage('segments', Math.max(4, FIELDS.length * n * 4));
  segmentRuns(geometry, data).forEach((run, i) => {
    buffers.device.queue.writeBuffer(buffer, i * n * 4, run.buffer, run.byteOffset, Math.min(run.byteLength, n * 4));
  });
  return buffer;
}

/** How graph.wgsl colours and sizes segments; one write changes it all. */
export class StyleUniform {
  readonly buffer: GPUBuffer;
  private readonly data = new ArrayBuffer(STYLE_BYTES);

  constructor(buffers: Buffers) {
    this.buffer = buffers.uniform('style', this.data);
  }

  /** `dim` when unselected segments should fade now. */
  write(device: GPUDevice, style: Style, graph: StyledGraph, dim: boolean): void {
    packStyle(this.data, style, graph, dim);
    device.queue.writeBuffer(this.buffer, 0, this.data);
  }
}
