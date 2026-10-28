import type { ErrorResponse, WorkerMemory } from '../rpc';
import type { FindQuery } from '../graph/findQuery';
import type { Compression } from '../graph/readFile';
import type { FastaRecords, SequenceSource } from './sequence';

export type GraphRequest =
  | { type: 'ping'; id: number }
  | { type: 'memory'; id: number }
  | { type: 'parse'; id: number; file: File }
  | { type: 'info'; id: number; segment: number }
  /** One bit per segment. */
  | { type: 'summary'; id: number; bits: Uint32Array<ArrayBuffer> }
  | { type: 'find'; id: number; query: FindQuery }
  /** Names and depths for a FASTA export, in Bandage's order. */
  | { type: 'export'; id: number; segments: Uint32Array<ArrayBuffer> }
  | { type: 'label-sizes'; id: number; content: LabelContent }
  | { type: 'label-text'; id: number; segments: Uint32Array<ArrayBuffer>; content: LabelContent }
  | { type: 'paths'; id: number }
  | { type: 'path-steps'; id: number; path: number };

export type GraphResponse =
  | { type: 'pong'; id: number; coreVersion: string }
  | { type: 'memory'; id: number; memory: WorkerMemory }
  | { type: 'progress'; id: number; bytesRead: number; totalBytes: number }
  | { type: 'parsed'; id: number; result: ParseResult; sequences: SequenceSource }
  | { type: 'info'; id: number; info: SegmentInfo | undefined }
  | { type: 'summary'; id: number; summary: SelectionSummary }
  | { type: 'found'; id: number; segments: Uint32Array<ArrayBuffer>; missing: string[] }
  | { type: 'export'; id: number; records: FastaRecords }
  /** Per segment its placing rank, then its label's box, as labels.wgsl reads them. */
  | { type: 'label-sizes'; id: number; sizes: Uint32Array<ArrayBuffer> }
  /** Each segment's label, lines joined by newlines. */
  | { type: 'label-text'; id: number; texts: string[] }
  | { type: 'paths'; id: number; paths: PathList }
  /** Segment ids, with `REVERSE_STEP` set on reverse steps. */
  | { type: 'path-steps'; id: number; steps: Uint32Array<ArrayBuffer> }
  | ErrorResponse;

/** `REVERSE` in gfa-core store/paths.rs. */
export const REVERSE_STEP = 0x80000000;

/** The P and W records, in file order. */
export interface PathList {
  names: string[];
  /** 1 for a walk (W), 0 for a path (P). */
  walks: Uint8Array<ArrayBuffer>;
  steps: Uint32Array<ArrayBuffer>;
  /** Segment lengths less the overlaps between steps. */
  lengths: Float64Array<ArrayBuffer>;
}

/** Which lines a label shows, in Bandage's order (`getNodeText`). */
export interface LabelContent {
  /** The LB and L2 tags. */
  custom: boolean;
  name: boolean;
  length: boolean;
  depth: boolean;
}

/** A link at one of the segment's ends: `from` leaves its end into `to`. */
export interface SegmentLink {
  other: number;
  otherName: string;
  from: number;
  fromReverse: boolean;
  to: number;
  toReverse: boolean;
}

export interface SegmentInfo {
  segment: number;
  name: string;
  length: number;
  /** NaN when unknown. */
  depth: number;
  /** NaN without a sequence. */
  gc: number;
  /** Rank, largest first, from 0. */
  component: number;
  degreeStart: number;
  degreeEnd: number;
  /** At most `INFO_LINKS` of `totalLinks`. */
  links: SegmentLink[];
  totalLinks: number;
}

export interface SelectionSummary {
  count: number;
  totalLength: number;
  /** Length-weighted over segments with a depth; NaN when none has one. */
  meanDepth: number;
}

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
  /** Bandage's automatic depth range, over segments with a depth; NaN when none has one. */
  depthQ1: number;
  depthQ3: number;
  depthMin: number;
  depthMax: number;
  /** NaN when no segment has a sequence. */
  gcMin: number;
  gcMax: number;
}

/** Per component, by rank. */
export interface ComponentTable {
  segments: Uint32Array;
  lengths: Float64Array;
  /** Length-weighted over segments with a depth; NaN when none has one. */
  meanDepths: Float64Array;
  /** 1 when the component is a single loop. */
  circular: Uint8Array;
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

/** Bandage's CL or C2 tags: segments in ascending order and their colours, RGBA8 with red in the low byte. */
export interface TagColors {
  segments: Uint32Array<ArrayBuffer>;
  colors: Uint32Array<ArrayBuffer>;
}

/** What segments are coloured and sized by. */
export interface SegmentAttributes {
  /** NaN when unknown. */
  depth: Float32Array<ArrayBuffer>;
  /** NaN without a sequence. */
  gc: Float32Array<ArrayBuffer>;
  /** CL tags. */
  tagColors: TagColors;
  /** C2 tags, for the reverse strand. */
  tagColors2: TagColors;
}

export interface ParseResult {
  format: 'gfa' | 'fastg';
  version: string | undefined;
  compression: Compression;
  stats: GraphStats;
  /** By rank, largest total length first. */
  components: ComponentTable;
  warnings: ParseWarnings;
  topology: Topology;
  attributes: SegmentAttributes;
  memory: { bytesPerSegment: number; nameBytes: number; sequenceBytes: number; sequencesDropped: boolean };
  parseMs: number;
}
