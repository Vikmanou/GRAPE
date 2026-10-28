import type { SegmentAttributes } from '../../workers/protocol/graph';
import type { CpuProgress, Geometry, Hierarchy, LayoutControl, PositionGrid } from '../../workers/protocol/layout';
import type { WithoutId } from '../../workers/rpc';
import type { DisplayOptions } from '../style/display';
import type { Atlas } from '../text/Atlas';
import type { Theme } from '../style/palette';
import type { Bounds } from './camera';

/** What a backend draws: the camera relative to the positions' origin, in canvas pixels. */
export interface View {
  centerX: number;
  centerY: number;
  /** Pixels per world unit. */
  zoom: number;
  width: number;
  height: number;
}

/** Per segment, what segments are coloured and sized by. */
export interface SegmentData extends SegmentAttributes {
  lengths: Uint32Array;
  /** Component rank, largest first. */
  components: Uint32Array;
  /** Length-weighted, over segments with a depth; NaN when none has one. */
  meanDepth: number;
  /** The highlighted path colour of each segment, RGBA8, 0 for none. */
  pathColors?: Uint32Array | undefined;
}

export interface Style {
  theme: Theme;
  display: DisplayOptions;
}

/** The spec's "first usable layout": refined to this level or finer, and packed. */
export const USABLE_LEVEL = 3;

export interface LayoutProgress {
  iteration: number;
  total: number;
  level: number;
  levels: number;
  energy: number;
  done: boolean;
}

export interface Origin {
  x: number;
  y: number;
}

/** Runs a layout and keeps its positions where the backend draws from. */
export interface LayoutDriver {
  /** A layout exists, running or settled. */
  readonly active: boolean;
  /** The frame loop should keep going for the layout's sake. */
  readonly busy: boolean;
  /** Refined to `USABLE_LEVEL` or finer, or no layout is running. */
  readonly usable: boolean;
  start(hierarchy: Hierarchy, seed: number): void;
  stop(): void;
  setPaused(paused: boolean): void;
  /** `dx, dy` per component, packing the boxes of the last `measured` event. */
  setOffsets(offsets: Float32Array): void;
  /** The packed graph's extent, once a pack has arrived. */
  bounds(): Bounds | undefined;
  /** Runs this frame's share of the layout. Returns whether positions moved. */
  tick(now: number, interactive: boolean): boolean;
  /** Writes the latest positions, relative to `origin`, to where the backend draws from. */
  present(origin: Origin): void;
  /** The running or last layout, level by level. */
  readonly levels: LevelRecord[];
  /** `x, y` per point as packed. */
  readPositions(): Promise<Float32Array<ArrayBuffer> | undefined>;
  /** Pinning and refinement need the layout at its finest level. */
  readonly atLevelZero: boolean;
  /** How many segments are pinned. */
  readonly pinned: number;
  /** Moves a segment by `dx, dy` world units and pins it; the rest follows in a short refinement. */
  drag(segment: number, dx: number, dy: number): void;
  unpinAll(): void;
  /** Refines level 0 again, moving only the selected segments when `onlySelected`. */
  refine(onlySelected: boolean): void;
  /** Where a layout run in the layout worker stands; drivers that run their own ignore it. */
  setProgress(progress: CpuProgress): void;
}

export interface BackendEvents {
  error(message: string): void;
  lost(message: string): void;
  /** `x0, y0, x1, y1` per component, unpacked, as the layout runs. */
  measured(boxes: Float32Array<ArrayBuffer>, progress: LayoutProgress): void;
  /** A refinement after a drag or of the selection started or ended. */
  refining(active: boolean): void;
  /** A request for a layout run in the layout worker. */
  control?(request: WithoutId<LayoutControl>): void;
}

/** One level of a GPU layout: its size, the iterations it ran and the time they took. */
export interface LevelRecord {
  level: number;
  nodes: number;
  iterations: number;
  /** From timestamp queries; 0 where the adapter has none. */
  gpuMs: number;
  /** From the level's first batch to the next level's, or to the end. */
  wallMs: number;
}

/** Segments whose labels won their screen cells, best rank first, and their ranks. */
export interface PlacedLabels {
  segments: Uint32Array<ArrayBuffer>;
  ranks: Uint32Array<ArrayBuffer>;
}

/** A label's box per character and per line, and the side of a screen grid cell, in canvas pixels. */
export interface LabelMetrics {
  advance: number;
  lineHeight: number;
  cell: number;
}

/** Everything that touches the GPU. The engine above it never does. */
export interface Backend {
  readonly kind: 'webgpu' | 'webgl2';
  readonly layout: LayoutDriver;
  readonly maxCanvasSize: number;
  /** GPU time of recent draws in milliseconds, 0 where the GPU cannot tell. */
  readonly drawMs: number;
  /** Bytes of GPU memory the backend holds. */
  readonly gpuBytes: number;
  /** `seed` steps the random colours. */
  setGraph(geometry: Geometry, segments: SegmentData, seed: number): void;
  setStyle(style: Style): void;
  /** `x, y` per point relative to the view's origin, from a layout run elsewhere, and a grid over them in that frame. */
  setPositions(positions: Float32Array<ArrayBuffer>, grid?: PositionGrid): void;
  /** One bit per segment, and how many are set. */
  setSelection(bits: Uint32Array<ArrayBuffer>, count: number): void;
  setHover(segment: number | undefined): void;
  /** One RGBA8 colour per segment for the path colour mode, 0 for a segment on no highlighted path. */
  setPathColors(colors: Uint32Array<ArrayBuffer>): void;
  draw(view: View): void;
  /** The segment drawn at canvas pixel `x, y` in the last drawn view. */
  pick(x: number, y: number): Promise<number | undefined>;
  /** One bit per segment whose ribbon touches a box of canvas pixels in the last drawn view. */
  selectBox(box: Bounds): Promise<Uint32Array<ArrayBuffer>>;
  /** The drawn extent, relative to the view's origin, of segments whose bit is set. */
  bounds(of: Uint32Array<ArrayBuffer>): Promise<Bounds | undefined>;
  setAtlas(atlas: Atlas): void;
  /** Per segment its placing rank, then its label's box (labels.wgsl); undefined drops labels. */
  setLabelSizes(sizes: Uint32Array<ArrayBuffer> | undefined): void;
  /** Places labels in the last drawn view so none overlap. */
  placeLabels(metrics: LabelMetrics): Promise<PlacedLabels>;
  /** Glyph instances from `layoutLabels` at `fontPx` canvas pixels, drawn over the graph. */
  setLabels(glyphs: Float32Array<ArrayBuffer>, fontPx: number): void;
  destroy(): void;
}
