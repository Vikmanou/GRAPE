import type { SegmentInfo, SelectionSummary } from '../workers/protocol/graph';
import type { Preview } from '../workers/sequence/SequenceClient';
import type { Context } from './store';

/** Bases shown at each end of a sequence and of a raw line. */
export const PREVIEW_BASES = 100;

export type Details =
  | { state: 'none' }
  | { state: 'loading' }
  | {
      state: 'segment';
      info: SegmentInfo;
      /** Undefined when sequences could not be read. */
      preview: Preview | undefined;
      /** Undefined for gzipped input, which cannot be read at an offset. */
      rawLine: { text: string; elided: number } | undefined;
      sequenceError: string | undefined;
    }
  | { state: 'many'; summary: SelectionSummary }
  | { state: 'failed'; message: string };

export interface DetailsSlice {
  details: Details;
  /** Fetches what the info panel shows for the current selection. */
  refreshDetails: () => void;
  /** The selected sequences, joined by newlines as Bandage copies them, in Bandage's order. */
  selectedSequences: () => Promise<string>;
  /** FASTA of the selection exactly as Bandage saves it. */
  selectedFasta: () => Promise<Blob>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Ids of the set bits, ascending. */
export function setBits(bits: Uint32Array): Uint32Array<ArrayBuffer> {
  const ids: number[] = [];
  for (const [w, word] of bits.entries()) {
    for (let b = 0, rest = word; rest !== 0; b++, rest >>>= 1) if (rest & 1) ids.push(w * 32 + b);
  }
  return Uint32Array.from(ids);
}

export function createDetailsSlice(ctx: Context): DetailsSlice {
  const { set, get, services } = ctx;
  let request = 0;

  const ordered = () => services.graph.exportRecords(setBits(get().selection.bits));

  return {
    details: { state: 'none' },

    refreshDetails() {
      const ticket = ++request;
      const { count, single, bits } = get().selection;
      const settle = (details: Details) => {
        if (ticket === request) set({ details });
      };
      if (count === 0) {
        settle({ state: 'none' });
        return;
      }
      settle({ state: 'loading' });
      if (single === undefined) {
        services.graph.summary(bits.slice()).then(
          (summary) => {
            settle({ state: 'many', summary });
          },
          (error: unknown) => {
            settle({ state: 'failed', message: message(error) });
          },
        );
        return;
      }
      const sequences = Promise.all([
        services.sequence.preview(single, PREVIEW_BASES),
        services.sequence.rawLine(single),
      ]).then(
        ([preview, rawLine]) => ({ preview, rawLine, sequenceError: undefined }),
        (error: unknown) => ({ preview: undefined, rawLine: undefined, sequenceError: message(error) }),
      );
      Promise.all([services.graph.info(single), sequences]).then(
        ([info, read]) => {
          if (!info) {
            settle({ state: 'failed', message: `segment ${single} is not in the graph` });
            return;
          }
          settle({ state: 'segment', info, ...read });
        },
        (error: unknown) => {
          settle({ state: 'failed', message: message(error) });
        },
      );
    },

    async selectedSequences() {
      const { segments } = await ordered();
      return services.sequence.sequence(segments);
    },

    async selectedFasta() {
      return services.sequence.fasta(await ordered());
    },
  };
}
