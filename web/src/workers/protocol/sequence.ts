import type { ErrorResponse, WorkerMemory } from '../rpc';

/** Gzipped input's bases, 2 bits each, with runs of other bytes and lowercase spans. */
export interface PackedArrays {
  bits: Uint8Array<ArrayBuffer>;
  bases: number;
  runStarts: Float64Array<ArrayBuffer>;
  runLengths: Uint32Array<ArrayBuffer>;
  runBytes: Uint8Array<ArrayBuffer>;
  lowerStarts: Float64Array<ArrayBuffer>;
  lowerLengths: Uint32Array<ArrayBuffer>;
}

interface PerSegment {
  lengths: Uint32Array<ArrayBuffer>;
  /** File byte offset (plain) or packed base offset (gzipped); -1 without a sequence. */
  offsets: Float64Array<ArrayBuffer>;
  flags: Uint8Array<ArrayBuffer>;
}

/** Where sequences come from, handed over by the graph worker after parsing. */
export type SequenceSource =
  | ({ kind: 'file'; file: File; lines: Float64Array<ArrayBuffer> } & PerSegment)
  | ({ kind: 'packed'; packed: PackedArrays } & PerSegment)
  /** Packing exceeded the memory budget and every sequence was dropped. */
  | { kind: 'dropped' };

export function sourceTransfers(source: SequenceSource): Transferable[] {
  if (source.kind === 'dropped') return [];
  const arrays = [source.lengths, source.offsets, source.flags];
  if (source.kind === 'file') return [...arrays, source.lines].map((a) => a.buffer);
  const p = source.packed;
  return [...arrays, p.bits, p.runStarts, p.runLengths, p.runBytes, p.lowerStarts, p.lowerLengths].map((a) => a.buffer);
}

/** Segments to export, in Bandage's order, with what their headers need. */
export interface FastaRecords {
  segments: Uint32Array<ArrayBuffer>;
  names: string[];
  depths: Float32Array<ArrayBuffer>;
}

/** For each segment of a merged graph, the steps through the original segments that spell it (gfa-core `Merged`). */
export interface ChainMap {
  /** `stepEnds[i - 1]` to `stepEnds[i]` index `steps` and `trims` for segment `i`. */
  stepEnds: Uint32Array<ArrayBuffer>;
  /** Original segment ids, with `REVERSE_STEP` set on reverse steps. */
  steps: Uint32Array<ArrayBuffer>;
  /** Bases cut from the start of each step. */
  trims: Uint32Array<ArrayBuffer>;
}

export function chainTransfers(map: ChainMap): ArrayBuffer[] {
  return [map.stepEnds.buffer, map.steps.buffer, map.trims.buffer];
}

/** What Bandage's GFA save writes, but for the sequences, in its order. */
export interface GfaRecords {
  segments: Uint32Array<ArrayBuffer>;
  names: string[];
  lengths: Uint32Array<ArrayBuffer>;
  depths: Float32Array<ArrayBuffer>;
  /** Each line's LB, L2, CL and C2 fields. */
  custom: string[];
  /** 0 none, 1 DP, 2 KC, 3 RC, 4 FC (gfa-wasm `depth_tag_code`). */
  depthTag: number;
  /** The L lines. */
  links: Uint8Array<ArrayBuffer>;
}

/** The shown graph's links, as gfa-core `Links` holds them, for joining hits. */
export interface SearchLinks {
  from: Uint32Array<ArrayBuffer>;
  to: Uint32Array<ArrayBuffer>;
  bits: Uint8Array<ArrayBuffer>;
  overlapFrom: Uint32Array<ArrayBuffer>;
  overlapTo: Uint32Array<ArrayBuffer>;
}

export function linkTransfers(links: SearchLinks): ArrayBuffer[] {
  return [links.from, links.to, links.bits, links.overlapFrom, links.overlapTo].map((a) => a.buffer);
}

export interface IndexInfo {
  k: number;
  /** Exact matches this long are always seeded; more than `k` past the index budget. */
  guaranteedMatch: number;
  segments: number;
  bases: number;
  bytes: number;
}

/** `query, score, q_start, q_end, matches, columns, parts` per hit; score is signed. */
export const HIT_WORDS = 7;
/** `segment, reverse, q_start, q_end, start, end` per part, the range on the forward strand. */
export const PART_WORDS = 6;

/** Every query's hits, best first within each query, each hit's parts in query order. */
export interface SearchResults {
  names: string[];
  lengths: Uint32Array<ArrayBuffer>;
  /** Hits found per query, which may be more than were kept. */
  totals: Uint32Array<ArrayBuffer>;
  hits: Uint32Array<ArrayBuffer>;
  parts: Uint32Array<ArrayBuffer>;
  tooShort: string[];
  /** Query k-mers too common to seed. */
  repeats: number;
  seedsCut: boolean;
}

export function resultTransfers(r: SearchResults): ArrayBuffer[] {
  return [r.lengths, r.totals, r.hits, r.parts].map((a) => a.buffer);
}

export type SequenceRequest =
  | { type: 'load'; id: number; source: SequenceSource }
  | { type: 'memory'; id: number }
  /** The first and last `bases` of a segment. */
  | { type: 'preview'; id: number; segment: number; bases: number }
  /** Sequences joined by newlines, as Bandage copies them. */
  | { type: 'sequence'; id: number; segments: Uint32Array<ArrayBuffer> }
  | { type: 'raw-line'; id: number; segment: number }
  | { type: 'fasta'; id: number; records: FastaRecords }
  /** Serves a merged graph's segments from the original sequences; undefined goes back to the original graph. */
  | { type: 'chains'; id: number; map: ChainMap | undefined }
  | { type: 'gfa'; id: number; records: GfaRecords }
  /** Indexes the shown graph's sequences, replacing any index. */
  | { type: 'build-index'; id: number; k: number; links: SearchLinks }
  /** Pasted text or a FASTA file, plain or gzipped. */
  | { type: 'search'; id: number; queries: string | Blob }
  /** Stops any indexing or search, which answers `cancelled`. */
  | { type: 'cancel-search'; id: number };

export type SequenceResponse =
  | { type: 'loaded'; id: number }
  | { type: 'memory'; id: number; memory: WorkerMemory }
  /** `head` holds the whole sequence when it is no longer than twice `bases`. */
  | { type: 'preview'; id: number; length: number; head: string; tail: string; missing: boolean }
  | { type: 'sequence'; id: number; text: string }
  /** `elided` bases were cut from the middle of a long sequence. Undefined for gzipped input. */
  | { type: 'raw-line'; id: number; line: { text: string; elided: number } | undefined }
  | { type: 'fasta'; id: number; blob: Blob }
  | { type: 'gfa'; id: number; blob: Blob }
  | { type: 'index-progress'; id: number; fraction: number }
  | { type: 'index-built'; id: number; info: IndexInfo }
  | { type: 'search-progress'; id: number; done: number; total: number }
  | { type: 'searched'; id: number; results: SearchResults }
  | { type: 'cancelled'; id: number }
  | ErrorResponse;
