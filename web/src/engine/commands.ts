import type { CpuProgress, Geometry, Hierarchy, LayoutControl, PositionGrid } from '../workers/protocol/layout';
import type { WithoutId } from '../workers/rpc';
import type { Insets } from './core/camera';
import type { FrameStats } from './core/frames';
import type { DisplayOptions } from './style/display';
import type { Theme } from './style/palette';
import type { LabelOptions } from './text/Labels';
import type { LayoutProgress, LevelRecord, SegmentData } from './core/backend';

export type EngineCommand =
  | { type: 'set-theme'; theme: Theme }
  | { type: 'set-display'; display: DisplayOptions }
  /** Labels for a new content or graph, numbered so late text for older ones is dropped; undefined hides them. */
  | { type: 'set-label-sizes'; generation: number; sizes: Uint32Array<ArrayBuffer> | undefined }
  /** Answers `labels-needed`. */
  | { type: 'set-label-text'; generation: number; segments: Uint32Array; texts: string[] }
  | { type: 'set-label-options'; options: LabelOptions }
  | { type: 'set-graph'; geometry: Geometry; seed: number; segments: SegmentData }
  /** One RGBA8 colour per segment for the path colour mode, 0 off every highlighted path. */
  | { type: 'set-path-colors'; colors: Uint32Array<ArrayBuffer> }
  /** `x, y` per point, in layout units, from a layout run in the worker, with its grid and progress. */
  | { type: 'set-positions'; positions: Float32Array; grid?: PositionGrid; progress?: CpuProgress }
  /** Lays the graph out on the GPU; components overlap until `set-offsets` arrives. */
  | { type: 'start-layout'; hierarchy: Hierarchy; seed: number }
  /** `dx, dy` per component, packing the boxes of the last `layout-measured`. */
  | { type: 'set-offsets'; offsets: Float32Array }
  | { type: 'pause-layout'; paused: boolean }
  /** Answered by a `positions` event. */
  | { type: 'read-positions' }
  /** Answered by a `memory` event. */
  | { type: 'report-memory' }
  /** Answered by a `layout-profile` event. */
  | { type: 'report-layout-profile' }
  | { type: 'fit' }
  /** Pans by fractions of the view's width and height. */
  | { type: 'pan-view'; fx: number; fy: number }
  /** Zooms about the view's centre. */
  | { type: 'zoom-view'; factor: number }
  /** CSS pixels of the canvas covered by panels, kept clear when fitting. */
  | { type: 'set-insets'; insets: Insets }
  /** Answered by a `picked` event: the segment drawn at canvas pixel `x, y`. */
  | { type: 'pick'; x: number; y: number }
  | { type: 'select'; segments: Uint32Array; mode: 'replace' | 'add' }
  /** Selects every segment of one component, by rank. */
  | { type: 'select-component'; component: number }
  /** Adds every segment of the components the selection touches. */
  | { type: 'select-components' }
  | { type: 'clear-selection' }
  | { type: 'invert-selection' }
  /** `follow` centres the selection, zooming out only if it does not fit. */
  | { type: 'zoom-to-selection'; follow?: boolean }
  | { type: 'unpin-all' }
  | { type: 'relayout-selection' }
  | { type: 'zoom-to-component'; component: number };

export type EngineEvent =
  | { type: 'resize'; width: number; height: number }
  | { type: 'device-lost'; message: string }
  | { type: 'error'; message: string }
  /** `x0, y0, x1, y1` per component as the GPU layout runs, a few times a second. */
  | { type: 'layout-measured'; boxes: Float32Array<ArrayBuffer>; progress: LayoutProgress }
  /** Sent after each second of continuous drawing, such as a pan or zoom. */
  | ({ type: 'frame-stats' } & FrameStats)
  /** `x, y` per point as drawn, answering `read-positions`. */
  | { type: 'positions'; positions: Float32Array<ArrayBuffer> }
  /** GPU buffer bytes, and bytes of the typed arrays the engine keeps on the CPU. */
  | { type: 'memory'; gpu: number; cpu: number }
  | { type: 'layout-profile'; levels: LevelRecord[] }
  | { type: 'picked'; x: number; y: number; segment: number | undefined }
  /** The camera after it moved, at most `CAMERA_EVENT_MS` apart. */
  | { type: 'camera'; x: number; y: number; zoom: number }
  /** A refinement after a drag or of the selection started or ended. */
  | { type: 'refining'; active: boolean }
  /** For the layout worker: the CPU layout's driver wants the run paused, a segment dragged, pins cleared or a refinement. */
  | { type: 'layout-control'; request: WithoutId<LayoutControl> }
  /** How many segments the user has pinned by dragging. */
  | { type: 'pins'; count: number }
  /** The segment under the pointer changed. */
  | { type: 'hover'; segment: number | undefined }
  /** Placed labels lack their text. */
  | { type: 'labels-needed'; generation: number; segments: Uint32Array<ArrayBuffer> }
  /** The segments whose labels show. */
  | { type: 'labels'; segments: Uint32Array<ArrayBuffer> }
  /** One bit per segment. `single` is the selected segment when exactly one is. */
  | { type: 'selection'; count: number; single: number | undefined; bits: Uint32Array<ArrayBuffer> };
