import type { ErrorResponse } from '../rpc';
import type { Topology } from './graph';

export type Quality = 'fast' | 'balanced' | 'best';

export interface LayoutOptions {
  /** A u32. */
  seed: number;
  quality: Quality;
}

export type LayoutRequest =
  /** Runs the CPU layout to the end, posting positions as it goes. */
  | { type: 'layout'; id: number; topology: Topology; options: LayoutOptions }
  /** Coarsens only, for the GPU layout; later `pack` requests use its components. */
  | { type: 'hierarchy'; id: number; topology: Topology; options: LayoutOptions }
  /** `x0, y0, x1, y1` per component. */
  | { type: 'pack'; id: number; boxes: Float32Array };

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

export type LayoutResponse =
  | { type: 'geometry'; id: number; geometry: Geometry; totalIterations: number }
  /** `x, y` per point. */
  | { type: 'positions'; id: number; positions: Float32Array; iteration: number; done: boolean }
  | { type: 'hierarchy'; id: number; hierarchy: Hierarchy }
  /** `dx, dy` per component. */
  | { type: 'packed'; id: number; offsets: Float32Array }
  | ErrorResponse;
