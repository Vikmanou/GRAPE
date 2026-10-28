// Owns the WASM module, so parsing never blocks the main thread.

import init, { coreVersion, FastaReader, type Loaded, Parser } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import { plain } from '../plain';
import type { GraphRequest, GraphResponse } from '../protocol/graph';
import { type ChainMap, chainTransfers, sourceTransfers } from '../protocol/sequence';
import { exportRecords, find, segmentInfo, summary } from './queries';
import { describe, gfaRecords, resultTransfers, sequenceSource } from './results';
import { type Compression, detectCompression, readFile } from './readFile';

const PROGRESS_INTERVAL_MS = 50;
/** Pieces small enough that progress can be posted between them. */
const PIECE_BYTES = 1 << 20;

const ready = init({ module_or_path: wasmUrl });

/** The parsed graph, answering queries until the next load frees it. */
let current: Loaded | undefined;
let compression: Compression = 'none';
/** The parsed graph with its chains merged, made the first time it is asked for. */
let merged: { loaded: Loaded; map: ChainMap; chains: number } | undefined;
let showMerged = false;

function post(message: GraphResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

/** Feeds `file` to `push` in pieces, posting progress for request `id`. */
async function stream(id: number, file: File, kind: Compression, push: (piece: Uint8Array) => void): Promise<void> {
  let lastProgress = 0;
  let bytesRead = 0;
  const report = (read: number) => {
    const now = performance.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    post({ type: 'progress', id, bytesRead: read, totalBytes: file.size });
  };
  await readFile(
    file,
    kind,
    (chunk) => {
      for (let at = 0; at < chunk.length; at += PIECE_BYTES) {
        push(chunk.subarray(at, at + PIECE_BYTES));
        // Plain files map chunk bytes to file bytes one to one.
        report(kind === 'none' ? bytesRead + Math.min(at + PIECE_BYTES, chunk.length) : bytesRead);
      }
    },
    (read) => {
      bytesRead = read;
      report(read);
    },
  );
}

function dropMerged(): void {
  merged?.loaded.free();
  merged = undefined;
  showMerged = false;
}

async function parse(id: number, file: File): Promise<void> {
  current?.free();
  current = undefined;
  dropMerged();
  const start = performance.now();
  compression = await detectCompression(file);
  const parser = new Parser(compression !== 'none');
  try {
    await stream(id, file, compression, (piece) => {
      parser.push(piece);
    });
    current = parser.finish();
  } finally {
    parser.free();
  }
  const result = describe(current, compression, performance.now() - start);
  const sequences = sequenceSource(current, file, compression);
  post({ type: 'parsed', id, result, sequences }, [...sourceTransfers(sequences), ...resultTransfers(result)]);
}

/** Gives the graph as loaded the sequences of a FASTA file, matched by name. */
async function addFasta(id: number, file: File): Promise<void> {
  const graph = original();
  dropMerged();
  const start = performance.now();
  const kind = await detectCompression(file);
  const reader = new FastaReader(kind !== 'none');
  let report: Float64Array;
  try {
    await stream(id, file, kind, (piece) => {
      reader.push(piece);
    });
    report = graph.attachFasta(reader);
  } finally {
    reader.free();
  }
  const [matched = 0, unknown = 0, resized = 0, dropped = 0] = report;
  const result = describe(graph, compression, performance.now() - start);
  const sequences = sequenceSource(graph, file, kind, false);
  post(
    { type: 'fasta-added', id, result, sequences, attached: { matched, unknown, resized, dropped: dropped === 1 } },
    [...sourceTransfers(sequences), ...resultTransfers(result)],
  );
}

function merge(id: number, on: boolean): void {
  showMerged = on;
  if (!on) {
    post({ type: 'merged', id, result: undefined, map: undefined, chains: 0 });
    return;
  }
  const start = performance.now();
  if (!merged) {
    const made = original().merge();
    const loaded = made.takeGraph();
    const map = { stepEnds: plain(made.stepEnds()), steps: plain(made.steps()), trims: plain(made.trims()) };
    const chains = made.chains();
    made.free();
    if (!loaded) throw new Error('the merged graph was already taken');
    merged = { loaded, map, chains };
  }
  const result = describe(merged.loaded, compression, performance.now() - start);
  const map = {
    stepEnds: merged.map.stepEnds.slice(),
    steps: merged.map.steps.slice(),
    trims: merged.map.trims.slice(),
  };
  post({ type: 'merged', id, result, map, chains: merged.chains }, [
    ...resultTransfers(result),
    ...chainTransfers(map),
  ]);
}

function original(): Loaded {
  if (!current) throw new Error('no graph is loaded');
  return current;
}

/** The graph on screen, which queries are about. */
function loaded(): Loaded {
  return showMerged && merged ? merged.loaded : original();
}

async function handle(request: GraphRequest): Promise<void> {
  try {
    await ready;
    const { id } = request;
    switch (request.type) {
      case 'ping':
        post({ type: 'pong', id, coreVersion: coreVersion() });
        return;
      case 'memory':
        post({ type: 'memory', id, memory: { wasm: (await ready).memory.buffer.byteLength, held: 0 } });
        return;
      case 'parse':
        await parse(id, request.file);
        return;
      case 'info':
        post({ type: 'info', id, info: segmentInfo(loaded(), request.segment) });
        return;
      case 'summary':
        post({ type: 'summary', id, summary: summary(loaded(), request.bits) });
        return;
      case 'find': {
        const found = find(loaded(), request.query);
        post({ type: 'found', id, ...found }, [found.segments.buffer]);
        return;
      }
      case 'label-sizes': {
        const { custom, name, length, depth } = request.content;
        const sizes = plain(loaded().labelSizes(custom, name, length, depth));
        post({ type: 'label-sizes', id, sizes }, [sizes.buffer]);
        return;
      }
      case 'label-text': {
        const { custom, name, length, depth } = request.content;
        post({ type: 'label-text', id, texts: loaded().labelText(request.segments, custom, name, length, depth) });
        return;
      }
      case 'distances': {
        const distances = plain(loaded().distances(request.bits));
        post({ type: 'distances', id, distances }, [distances.buffer]);
        return;
      }
      case 'paths': {
        const g = loaded();
        const paths = {
          names: g.pathNames(),
          walks: plain(g.pathKinds()),
          steps: plain(g.pathStepCounts()),
          lengths: plain(g.pathLengths()),
        };
        post({ type: 'paths', id, paths }, [paths.walks.buffer, paths.steps.buffer, paths.lengths.buffer]);
        return;
      }
      case 'path-steps': {
        const steps = plain(loaded().pathSteps(request.path));
        post({ type: 'path-steps', id, steps }, [steps.buffer]);
        return;
      }
      case 'merge':
        merge(id, request.on);
        return;
      case 'add-fasta':
        await addFasta(id, request.file);
        return;
      case 'gfa': {
        const records = gfaRecords(loaded());
        post({ type: 'gfa', id, records }, [
          records.segments.buffer,
          records.lengths.buffer,
          records.depths.buffer,
          records.links.buffer,
        ]);
        return;
      }
      case 'export': {
        const records = exportRecords(loaded(), request.segments);
        post({ type: 'export', id, records }, [records.segments.buffer, records.depths.buffer]);
        return;
      }
    }
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener('message', (event: MessageEvent<GraphRequest>) => {
  void handle(event.data);
});
