// Every request carries an id that its responses echo.

import type { Compression } from './readFile';

export type ParseRequest = { type: 'ping'; id: number } | { type: 'parse'; id: number; file: File };

export type ParseResponse =
  | { type: 'pong'; id: number; coreVersion: string }
  | { type: 'progress'; id: number; bytesRead: number; totalBytes: number }
  | { type: 'parsed'; id: number; result: ParseResult }
  | { type: 'error'; id: number; message: string };

export interface GraphStats {
  segments: number;
  undefined: number;
  links: number;
  totalLength: number;
  n50: number;
  n75: number;
  longest: number;
  shortest: number;
  components: number;
  largestComponentLength: number;
  largestComponentSegments: number;
  deadEnds: number;
  isolated: number;
  /** NaN when no segment has a depth. */
  meanDepth: number;
  /** NaN when no segment has a sequence. */
  gc: number;
  paths: number;
  walks: number;
  containments: number;
  duplicateLinks: number;
}

export interface ParseWarnings {
  /** Includes warnings beyond the stored list. */
  total: number;
  lines: Float64Array;
  /** 1 for errors, 0 for warnings. */
  severities: Uint8Array;
  messages: string[];
}

export interface Topology {
  lengths: Uint32Array;
  /** Component rank per segment. */
  components: Uint32Array;
  linkFrom: Uint32Array;
  linkTo: Uint32Array;
  linkBits: Uint8Array;
}

export interface ParseResult {
  format: 'gfa' | 'fastg';
  version: string | undefined;
  compression: Compression;
  stats: GraphStats;
  /** By rank, largest total length first. */
  components: { segments: Uint32Array; lengths: Float64Array };
  warnings: ParseWarnings;
  topology: Topology;
  memory: { bytesPerSegment: number; nameBytes: number; sequenceBytes: number; sequencesDropped: boolean };
  parseMs: number;
}

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
  pieces: Uint32Array;
  /** `end a, inner a, end b, inner b` per link. */
  links: Uint32Array;
}

/** Floats inside `nodes`, `edges` and `children` are stored as their bits. */
export interface HierarchyLevel {
  /** `component, step size, first edge, end edge` per node. */
  nodes: Uint32Array;
  /** `neighbour, rest length, weight` per spring end. */
  edges: Uint32Array;
  /** Starting temperature per component, zero when frozen. */
  heat: Float32Array;
  repulsion: number;
  meanRest: number;
  iterations: number;
  /** Node in the next coarser level; empty on the coarsest. */
  parent: Uint32Array;
  /** `first, second or 0xffffffff, half distance` per node, into the next finer level. */
  children: Uint32Array;
}

export interface Hierarchy {
  /** Level 0 has one node per point; each next level is coarser. */
  levels: HierarchyLevel[];
  /** `x, y` per coarsest node. */
  start: Float32Array;
  /** 1 per component laid out straight and never moved. */
  frozen: Uint8Array;
}

export type LayoutResponse =
  | { type: 'geometry'; id: number; geometry: Geometry; totalIterations: number }
  /** `x, y` per point. */
  | { type: 'positions'; id: number; positions: Float32Array; iteration: number; done: boolean }
  | { type: 'hierarchy'; id: number; hierarchy: Hierarchy }
  /** `dx, dy` per component. */
  | { type: 'packed'; id: number; offsets: Float32Array }
  | { type: 'error'; id: number; message: string };
