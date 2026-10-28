import type { ChainMap } from '../protocol/sequence';
import type { Sequences } from './Sequences';

/** `REVERSE` in gfa-core store/paths.rs. */
const REVERSE = 0x80000000;

const decoder = new TextDecoder();

/**
 * A merged graph's sequences, spelled from the original ones as gfa-core's
 * chain merging defines them: each step's bases, reverse complemented on a
 * reverse step, less the trim at its start.
 */
export class Chained {
  constructor(
    private readonly original: Sequences,
    private readonly map: ChainMap,
    private readonly reverseComplement: (bases: Uint8Array) => Uint8Array,
  ) {}

  get available(): boolean {
    return this.original.available;
  }

  get heldBytes(): number {
    const m = this.map;
    return this.original.heldBytes + m.stepEnds.byteLength + m.steps.byteLength + m.trims.byteLength;
  }

  private range(segment: number): [number, number] {
    return [segment === 0 ? 0 : (this.map.stepEnds[segment - 1] ?? 0), this.map.stepEnds[segment] ?? 0];
  }

  length(segment: number): number {
    const [start, end] = this.range(segment);
    let total = 0;
    for (let k = start; k < end; k++) {
      total += this.original.length((this.map.steps[k] ?? 0) & ~REVERSE) - (this.map.trims[k] ?? 0);
    }
    return total;
  }

  async bases(segment: number): Promise<Uint8Array | undefined> {
    const [start, end] = this.range(segment);
    const parts: Uint8Array[] = [];
    for (let k = start; k < end; k++) {
      const step = this.map.steps[k] ?? 0;
      const forward = await this.original.bases((step & ~REVERSE) >>> 0);
      if (!forward) return undefined;
      const bases = step & REVERSE ? this.reverseComplement(forward) : forward;
      parts.push(bases.subarray(this.map.trims[k] ?? 0));
    }
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  async preview(segment: number, n: number): Promise<{ head: string; tail: string } | undefined> {
    const all = await this.bases(segment);
    if (!all) return undefined;
    if (all.length <= 2 * n) return { head: decoder.decode(all), tail: '' };
    return { head: decoder.decode(all.subarray(0, n)), tail: decoder.decode(all.subarray(all.length - n)) };
  }

  /** A segment left alone by merging keeps its line; a merged one has none. */
  async rawLine(segment: number, keep: number): Promise<{ text: string; elided: number } | undefined> {
    const [start, end] = this.range(segment);
    const step = this.map.steps[start] ?? REVERSE;
    if (end - start !== 1 || step & REVERSE) return undefined;
    return this.original.rawLine(step, keep);
  }
}
