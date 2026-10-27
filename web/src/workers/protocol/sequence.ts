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

export type SequenceRequest =
  | { type: 'load'; id: number; source: SequenceSource }
  | { type: 'memory'; id: number }
  /** The first and last `bases` of a segment. */
  | { type: 'preview'; id: number; segment: number; bases: number }
  /** Sequences joined by newlines, as Bandage copies them. */
  | { type: 'sequence'; id: number; segments: Uint32Array<ArrayBuffer> }
  | { type: 'raw-line'; id: number; segment: number }
  | { type: 'fasta'; id: number; records: FastaRecords };

export type SequenceResponse =
  | { type: 'loaded'; id: number }
  | { type: 'memory'; id: number; memory: WorkerMemory }
  /** `head` holds the whole sequence when it is no longer than twice `bases`. */
  | { type: 'preview'; id: number; length: number; head: string; tail: string; missing: boolean }
  | { type: 'sequence'; id: number; text: string }
  /** `elided` bases were cut from the middle of a long sequence. Undefined for gzipped input. */
  | { type: 'raw-line'; id: number; line: { text: string; elided: number } | undefined }
  | { type: 'fasta'; id: number; blob: Blob }
  | ErrorResponse;
