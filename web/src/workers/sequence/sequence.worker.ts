// Owns the sequences, so reading them and (from milestone 9) searching them
// never holds up the graph worker's queries.

import init, { basesFromFile, fastaRecord, PackedSequences } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { FastaRecords, SequenceRequest, SequenceResponse, SequenceSource } from '../protocol/sequence';
import { type HeldSource, Sequences } from './Sequences';

const ready = init({ module_or_path: wasmUrl });
const encoder = new TextEncoder();
let sequences: Sequences | undefined;
let packed: PackedSequences | undefined;

function post(message: SequenceResponse): void {
  self.postMessage(message);
}

function load(source: SequenceSource): void {
  packed?.free();
  packed = undefined;
  let held: HeldSource = source;
  if (source.kind === 'packed') {
    const { packed: p, ...rest } = source;
    packed = new PackedSequences(p.bits, p.bases, p.runStarts, p.runLengths, p.runBytes, p.lowerStarts, p.lowerLengths);
    held = rest;
  }
  const current = packed;
  sequences = new Sequences(held, {
    basesFromFile,
    packedBases: current && ((start, length, flags) => current.bases(start, length, flags)),
  });
}

function loaded(): Sequences {
  if (!sequences) throw new Error('no sequences are loaded');
  if (!sequences.available) {
    throw new Error('Sequences exceeded the memory budget when the file was read, so they are not available.');
  }
  return sequences;
}

/** Bandage copies sequences joined by newlines, a missing one as N for every base. */
async function joined(segments: Uint32Array): Promise<string> {
  const s = loaded();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  for (const segment of segments) {
    const bases = await s.bases(segment);
    parts.push(bases ? decoder.decode(bases) : 'N'.repeat(s.length(segment)));
  }
  return parts.join('\n');
}

async function fasta(records: FastaRecords): Promise<Blob> {
  const s = loaded();
  const parts: Uint8Array<ArrayBuffer>[] = [];
  for (const [i, segment] of records.segments.entries()) {
    const bases = await s.bases(segment);
    const name = encoder.encode(records.names[i] ?? '');
    parts.push(fastaRecord(name, s.length(segment), records.depths[i] ?? NaN, bases) as Uint8Array<ArrayBuffer>);
  }
  return new Blob(parts, { type: 'text/plain' });
}

async function handle(request: SequenceRequest): Promise<void> {
  await ready;
  switch (request.type) {
    case 'memory':
      post({
        type: 'memory',
        id: request.id,
        memory: { wasm: (await ready).memory.buffer.byteLength, held: sequences?.heldBytes ?? 0 },
      });
      return;
    case 'load':
      load(request.source);
      post({ type: 'loaded', id: request.id });
      return;
    case 'preview': {
      const s = loaded();
      const preview = await s.preview(request.segment, request.bases);
      const length = s.length(request.segment);
      post({
        type: 'preview',
        id: request.id,
        length,
        head: preview?.head ?? '',
        tail: preview?.tail ?? '',
        missing: !preview,
      });
      return;
    }
    case 'sequence':
      post({ type: 'sequence', id: request.id, text: await joined(request.segments) });
      return;
    case 'raw-line':
      post({ type: 'raw-line', id: request.id, line: await sequences?.rawLine(request.segment, 100) });
      return;
    case 'fasta':
      post({ type: 'fasta', id: request.id, blob: await fasta(request.records) });
      return;
  }
}

self.addEventListener('message', (event: MessageEvent<SequenceRequest>) => {
  const request = event.data;
  handle(request).catch((error: unknown) => {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
});
