// Owns the WASM module, so parsing never blocks the main thread.

import init, { coreVersion, type Loaded, Parser } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { GraphRequest, GraphResponse, ParseResult } from '../protocol/graph';
import { type Compression, detectCompression, readFile } from './readFile';

const PROGRESS_INTERVAL_MS = 50;
/** Pieces small enough that progress can be posted between them. */
const PIECE_BYTES = 1 << 20;

const ready = init({ module_or_path: wasmUrl });

/** Kept for later milestones (layout, info panel); freed on the next load. */
let current: Loaded | undefined;

function post(message: GraphResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

async function parse(id: number, file: File): Promise<void> {
  current?.free();
  current = undefined;
  const start = performance.now();
  const compression = await detectCompression(file);
  const parser = new Parser(compression !== 'none');
  let lastProgress = 0;
  let bytesRead = 0;
  const report = (read: number) => {
    const now = performance.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    post({ type: 'progress', id, bytesRead: read, totalBytes: file.size });
  };
  try {
    await readFile(
      file,
      compression,
      (chunk) => {
        for (let at = 0; at < chunk.length; at += PIECE_BYTES) {
          parser.push(chunk.subarray(at, at + PIECE_BYTES));
          // Plain files map chunk bytes to file bytes one to one.
          report(compression === 'none' ? bytesRead + Math.min(at + PIECE_BYTES, chunk.length) : bytesRead);
        }
      },
      (read) => {
        bytesRead = read;
        report(read);
      },
    );
    current = parser.finish();
  } finally {
    parser.free();
  }
  const result = describe(current, compression, performance.now() - start);
  const { components, warnings, topology } = result;
  post({ type: 'parsed', id, result }, [
    components.segments.buffer,
    components.lengths.buffer,
    warnings.lines.buffer,
    warnings.severities.buffer,
    topology.lengths.buffer,
    topology.components.buffer,
    topology.linkFrom.buffer,
    topology.linkTo.buffer,
    topology.linkBits.buffer,
  ]);
}

function describe(loaded: Loaded, compression: Compression, parseMs: number): ParseResult {
  const s = loaded.summary();
  const format = loaded.format() === 'fastg' ? 'fastg' : 'gfa';
  const result: ParseResult = {
    format,
    version: loaded.version(),
    compression,
    stats: {
      segments: s.segments,
      undefined: s.undefined,
      links: s.links,
      totalLength: s.totalLength,
      n50: s.n50,
      n75: s.n75,
      longest: s.longest,
      shortest: s.shortest,
      components: s.components,
      largestComponentLength: s.largestComponentLength,
      largestComponentSegments: s.largestComponentSegments,
      deadEnds: s.deadEnds,
      isolated: s.isolated,
      meanDepth: s.meanDepth,
      gc: s.gc,
      paths: s.paths,
      walks: s.walks,
      containments: s.containments,
      duplicateLinks: s.duplicateLinks,
    },
    components: { segments: loaded.componentSegments(), lengths: loaded.componentLengths() },
    warnings: {
      total: loaded.warningTotal(),
      lines: loaded.warningLines(),
      severities: loaded.warningSeverities(),
      messages: loaded.warningMessages(),
    },
    topology: {
      lengths: loaded.segmentLengths(),
      components: loaded.segmentComponents(),
      linkFrom: loaded.linkFrom(),
      linkTo: loaded.linkTo(),
      linkBits: loaded.linkBits(),
    },
    memory: {
      bytesPerSegment: s.bytesPerSegment,
      nameBytes: s.nameBytes,
      sequenceBytes: s.sequenceBytes,
      sequencesDropped: s.sequencesDropped,
    },
    parseMs,
  };
  s.free();
  return result;
}

async function handle(request: GraphRequest): Promise<void> {
  try {
    await ready;
    if (request.type === 'ping') {
      post({ type: 'pong', id: request.id, coreVersion: coreVersion() });
    } else {
      await parse(request.id, request.file);
    }
  } catch (error) {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  }
}

self.addEventListener('message', (event: MessageEvent<GraphRequest>) => {
  void handle(event.data);
});
