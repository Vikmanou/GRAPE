import type { SequenceSource } from '../protocol/sequence';

/** `seg_flags` in gfa-core store/segments.rs. */
const SEQ_WRAPPED = 4;
const SEQ_REVERSED = 8;
/** Tags after a sequence, or a FASTG header, are read up to this far. */
const LINE_TAIL_BYTES = 64 * 1024;

/** The WASM calls this reader needs, passed in so tests can fake them. */
export interface Core {
  basesFromFile(bytes: Uint8Array, length: number, flags: number): Uint8Array | undefined;
  /** Undefined for plain input. */
  packedBases: ((start: number, length: number, flags: number) => Uint8Array | undefined) | undefined;
}

const decoder = new TextDecoder();
const text = (bytes: Uint8Array) => decoder.decode(bytes);

export class Sequences {
  constructor(
    private readonly source: SequenceSource,
    private readonly core: Core,
  ) {}

  length(segment: number): number {
    return this.source.kind === 'dropped' ? 0 : (this.source.lengths[segment] ?? 0);
  }

  get heldBytes(): number {
    const s = this.source;
    if (s.kind === 'dropped') return 0;
    const own = s.lengths.byteLength + s.offsets.byteLength + s.flags.byteLength;
    if (s.kind === 'file') return own + s.lines.byteLength;
    const p = s.packed;
    return [p.bits, p.runStarts, p.runLengths, p.runBytes, p.lowerStarts, p.lowerLengths].reduce(
      (sum, a) => sum + a.byteLength,
      own,
    );
  }

  get available(): boolean {
    return this.source.kind !== 'dropped';
  }

  /** The segment's forward bases, or undefined when the file gives none. */
  async bases(segment: number): Promise<Uint8Array | undefined> {
    const s = this.source;
    if (s.kind === 'dropped') return undefined;
    const offset = s.offsets[segment] ?? -1;
    const length = s.lengths[segment] ?? 0;
    const flags = s.flags[segment] ?? 0;
    if (offset < 0) return undefined;
    if (s.kind === 'packed') return this.core.packedBases?.(offset, length, flags);
    // Wrapped FASTG lines take more bytes than bases; read more until they suffice.
    let span = flags & SEQ_WRAPPED ? Math.ceil(length * 1.1) + 1024 : length;
    for (;;) {
      const bytes = await read(s.file, offset, offset + span);
      const bases = this.core.basesFromFile(bytes, length, flags);
      if (bases || offset + span >= s.file.size) return bases;
      span *= 2;
    }
  }

  /** The first and last `n` bases; the whole sequence in `head` when it is short. */
  async preview(segment: number, n: number): Promise<{ head: string; tail: string } | undefined> {
    const length = this.length(segment);
    if (length <= 2 * n) {
      const all = await this.bases(segment);
      return all && { head: text(all), tail: '' };
    }
    const s = this.source;
    const simple = s.kind !== 'dropped' && ((s.flags[segment] ?? 0) & (SEQ_WRAPPED | SEQ_REVERSED)) === 0;
    if (s.kind === 'dropped' || !simple) {
      const all = await this.bases(segment);
      return all && { head: text(all.subarray(0, n)), tail: text(all.subarray(length - n)) };
    }
    const offset = s.offsets[segment] ?? -1;
    if (offset < 0) return undefined;
    if (s.kind === 'packed') {
      const head = this.core.packedBases?.(offset, n, 0);
      const tail = this.core.packedBases?.(offset + length - n, n, 0);
      return head && tail && { head: text(head), tail: text(tail) };
    }
    const [head, tail] = await Promise.all([
      read(s.file, offset, offset + n),
      read(s.file, offset + length - n, offset + length),
    ]);
    return { head: text(head), tail: text(tail) };
  }

  /**
   * The segment's line as the file has it, with all but the first and last
   * `keep` bases of a long sequence cut out. Undefined for gzipped input.
   */
  async rawLine(segment: number, keep: number): Promise<{ text: string; elided: number } | undefined> {
    const s = this.source;
    if (s.kind !== 'file') return undefined;
    const start = s.lines[segment];
    if (start === undefined) return undefined;
    const offset = s.offsets[segment] ?? -1;
    const length = s.lengths[segment] ?? 0;
    const flags = s.flags[segment] ?? 0;
    // A FASTG record's line is its header; its sequence follows on other lines.
    if (offset < 0 || flags & SEQ_WRAPPED || length <= 2 * keep) {
      const end = offset < 0 || flags & SEQ_WRAPPED ? start : offset + length;
      return { text: firstLine(await read(s.file, start, end + LINE_TAIL_BYTES)), elided: 0 };
    }
    const [before, after] = await Promise.all([
      read(s.file, start, offset + keep),
      read(s.file, offset + length - keep, offset + length + LINE_TAIL_BYTES),
    ]);
    return { text: `${text(before)}…${firstLine(after)}`, elided: length - 2 * keep };
  }
}

async function read(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, Math.min(end, file.size)).arrayBuffer());
}

function firstLine(bytes: Uint8Array): string {
  const newline = bytes.indexOf(10);
  const line = newline < 0 ? bytes : bytes.subarray(0, newline);
  return text(line.at(-1) === 13 ? line.subarray(0, -1) : line);
}
