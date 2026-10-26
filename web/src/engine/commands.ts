import type { Geometry, Hierarchy } from '../workers/protocol';
import type { Insets } from './core/camera';
import type { FrameStats } from './core/frames';
import type { Theme } from './style/palette';
import type { LayoutProgress } from './webgpu/layout/runner';

export type EngineCommand =
  | { type: 'set-theme'; theme: Theme }
  | { type: 'set-graph'; geometry: Geometry; seed: number }
  /** `x, y` per point, in layout units, from a layout run elsewhere. */
  | { type: 'set-positions'; positions: Float32Array }
  /** Lays the graph out on the GPU; components overlap until `set-offsets` arrives. */
  | { type: 'start-layout'; hierarchy: Hierarchy; seed: number }
  /** `dx, dy` per component, packing the boxes of the last `layout-measured`. */
  | { type: 'set-offsets'; offsets: Float32Array }
  | { type: 'pause-layout'; paused: boolean }
  /** Answered by a `positions` event. */
  | { type: 'read-positions' }
  | { type: 'fit' }
  /** CSS pixels of the canvas covered by panels, kept clear when fitting. */
  | { type: 'set-insets'; insets: Insets };

export type EngineEvent =
  | { type: 'resize'; width: number; height: number }
  | { type: 'device-lost'; message: string }
  | { type: 'error'; message: string }
  /** `x0, y0, x1, y1` per component as the GPU layout runs, a few times a second. */
  | { type: 'layout-measured'; boxes: Float32Array<ArrayBuffer>; progress: LayoutProgress }
  /** Sent after each second of continuous drawing, such as a pan or zoom. */
  | ({ type: 'frame-stats' } & FrameStats)
  /** `x, y` per point as drawn, answering `read-positions`. */
  | { type: 'positions'; positions: Float32Array<ArrayBuffer> };
