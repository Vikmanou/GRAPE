import type { Geometry, Hierarchy } from '../../workers/protocol/layout';
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

export interface Style {
  theme: Theme;
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
  /** `x, y` per point as packed. */
  readPositions(): Promise<Float32Array<ArrayBuffer> | undefined>;
}

export interface BackendEvents {
  error(message: string): void;
  lost(message: string): void;
  /** `x0, y0, x1, y1` per component, unpacked, as the layout runs. */
  measured(boxes: Float32Array<ArrayBuffer>, progress: LayoutProgress): void;
}

/** Everything that touches the GPU. The engine above it never does. */
export interface Backend {
  readonly kind: 'webgpu' | 'webgl2';
  readonly layout: LayoutDriver;
  readonly maxCanvasSize: number;
  /** GPU time of recent draws in milliseconds, 0 where the GPU cannot tell. */
  readonly drawMs: number;
  setGraph(geometry: Geometry, colors: Uint32Array<ArrayBuffer>): void;
  setStyle(style: Style): void;
  /** `x, y` per point relative to the view's origin, from a layout run elsewhere. */
  setPositions(positions: Float32Array<ArrayBuffer>): void;
  /** One bit per segment, and how many are set. */
  setSelection(bits: Uint32Array<ArrayBuffer>, count: number): void;
  setHover(segment: number | undefined): void;
  draw(view: View): void;
  /** The segment drawn at canvas pixel `x, y` in the last drawn view. */
  pick(x: number, y: number): Promise<number | undefined>;
  /** One bit per segment whose ribbon touches a box of canvas pixels in the last drawn view. */
  selectBox(box: Bounds): Promise<Uint32Array<ArrayBuffer>>;
  destroy(): void;
}
