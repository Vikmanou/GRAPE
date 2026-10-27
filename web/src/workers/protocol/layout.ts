import type { ErrorResponse, WorkerMemory } from '../rpc';
import type { Topology } from './graph';

export type Quality = 'fast' | 'balanced' | 'best';

export interface LayoutOptions {
  /** A u32. */
  seed: number;
  quality: Quality;
}

export type LayoutRequest =
  /**
   * Runs the CPU layout, posting positions as it goes, and keeps answering
   * the control requests below until the worker ends; it never resolves.
   */
  | { type: 'layout'; id: number; topology: Topology; options: LayoutOptions }
  | { type: 'pause'; id: number; paused: boolean }
  /** Moves a segment by `dx, dy` layout units and pins it. */
  | { type: 'drag'; id: number; segment: number; dx: number; dy: number }
  | { type: 'unpin'; id: number }
  /** Refines level 0 again, moving only the segments whose bit is set when `selected` is given. */
  | { type: 'refine'; id: number; selected: Uint32Array<ArrayBuffer> | undefined }
  /** Coarsens only, for the GPU layout; later `pack` requests use its components. */
  | { type: 'hierarchy'; id: number; topology: Topology; options: LayoutOptions }
  /** `x0, y0, x1, y1` per component, and 1 per component laid out straight. */
  | { type: 'pack'; id: number; boxes: Float32Array; frozen: Uint8Array }
  | { type: 'memory'; id: number };

/** Requests that steer a running CPU layout. */
export type LayoutControl = Extract<LayoutRequest, { type: 'pause' | 'drag' | 'unpin' | 'refine' }>;

export interface Geometry {
  segments: number;
  points: number;
  /** `first point, segment` per ribbon piece. */
  pieces: Uint32Array<ArrayBuffer>;
  /** `end a, inner a, end b, inner b` per link. */
  links: Uint32Array<ArrayBuffer>;
  /** First point of each segment's chain. */
  segmentStarts: Uint32Array<ArrayBuffer>;
  /** Pieces in each segment's chain, which has one more point. */
  segmentPieces: Uint8Array<ArrayBuffer>;
}

/** Floats inside `nodes`, `edges` and `children` are stored as their bits. */
export interface HierarchyLevel {
  /** `component, step size, first edge, end edge` per node. */
  nodes: Uint32Array<ArrayBuffer>;
  /** `neighbour, rest length, weight` per spring end. */
  edges: Uint32Array<ArrayBuffer>;
  /** Starting temperature per component, zero when frozen. */
  heat: Float32Array<ArrayBuffer>;
  repulsion: number;
  meanRest: number;
  iterations: number;
  /** Node in the next coarser level; empty on the coarsest. */
  parent: Uint32Array<ArrayBuffer>;
  /** `first, second or 0xffffffff, half distance` per node, into the next finer level. */
  children: Uint32Array<ArrayBuffer>;
}

export interface Hierarchy {
  /** Level 0 has one node per point; each next level is coarser. */
  levels: HierarchyLevel[];
  /** `x, y` per coarsest node. */
  start: Float32Array<ArrayBuffer>;
  /** 1 per component laid out straight and never moved. */
  frozen: Uint8Array<ArrayBuffer>;
}

/** For each grid cell, row major, the items whose box overlaps it. */
export interface CellLists {
  /** `starts[c]` to `starts[c + 1]` index `items` for cell `c`. */
  starts: Uint32Array<ArrayBuffer>;
  items: Uint32Array<ArrayBuffer>;
  /** Items too large for the grid, which every query returns. */
  wide: Uint32Array<ArrayBuffer>;
}

/** A uniform grid over the ribbon pieces and links, in layout units (gfa-core `layout::Grid`). */
export interface PositionGrid {
  minX: number;
  minY: number;
  cell: number;
  columns: number;
  rows: number;
  pieces: CellLists;
  links: CellLists;
}

/** Where a CPU layout stands. */
export interface CpuProgress {
  iteration: number;
  level: number;
  levels: number;
  pinned: number;
  /** A refinement after a drag or of the selection is running. */
  refining: boolean;
  /** Settled, and no refinement runs. */
  done: boolean;
}

export type LayoutResponse =
  | { type: 'geometry'; id: number; geometry: Geometry; totalIterations: number }
  /** `x, y` per point, packed, and a grid over them. */
  | {
      type: 'positions';
      id: number;
      positions: Float32Array<ArrayBuffer>;
      grid: PositionGrid;
      progress: CpuProgress;
    }
  | { type: 'ok'; id: number }
  | { type: 'hierarchy'; id: number; hierarchy: Hierarchy }
  /** `dx, dy` per component. */
  | { type: 'packed'; id: number; offsets: Float32Array }
  | { type: 'memory'; id: number; memory: WorkerMemory }
  | ErrorResponse;
