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

/** The arrays the layout needs, moved from the parse worker to the layout worker. */
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

export type LayoutRequest = { type: 'layout'; id: number; topology: Topology; seed: number };

/** What the renderer draws, fixed for one layout run. */
export interface Geometry {
  points: number;
  /** `first point, segment` per ribbon piece. */
  pieces: Uint32Array;
  /** `end a, inner a, end b, inner b` per link. */
  links: Uint32Array;
}

export type LayoutResponse =
  | { type: 'geometry'; id: number; geometry: Geometry; totalIterations: number }
  /** `x, y` per point. */
  | { type: 'positions'; id: number; positions: Float32Array; iteration: number; done: boolean }
  | { type: 'error'; id: number; message: string };
