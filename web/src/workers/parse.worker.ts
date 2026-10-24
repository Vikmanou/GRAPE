// Owns the WASM module, so parsing never blocks the main thread.

import init, { coreVersion, type Loaded, Parser } from '../wasm/pkg/gfa_wasm';
import wasmUrl from '../wasm/pkg/gfa_wasm_bg.wasm?url';
import type { ParseRequest, ParseResponse, ParseResult } from './protocol';
import { isGzip, readFile } from './readFile';

const PROGRESS_INTERVAL_MS = 100;

const ready = init({ module_or_path: wasmUrl });

/** Kept for later milestones (layout, info panel); freed on the next load. */
let current: Loaded | undefined;

function post(message: ParseResponse, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

async function parse(id: number, file: File): Promise<void> {
  current?.free();
  current = undefined;
  const start = performance.now();
  const gzip = await isGzip(file);
  const parser = new Parser(gzip);
  let lastProgress = 0;
  try {
    await readFile(
      file,
      gzip,
      (chunk) => {
        parser.push(chunk);
      },
      (bytesRead) => {
        const now = performance.now();
        if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
        lastProgress = now;
        post({ type: 'progress', id, bytesRead, totalBytes: file.size });
      },
    );
    current = parser.finish();
  } finally {
    parser.free();
  }
  const result = describe(current, gzip, performance.now() - start);
  const { components, warnings } = result;
  post({ type: 'parsed', id, result }, [
    components.segments.buffer,
    components.lengths.buffer,
    warnings.lines.buffer,
    warnings.severities.buffer,
  ]);
}

function describe(loaded: Loaded, gzip: boolean, parseMs: number): ParseResult {
  const s = loaded.summary();
  const format = loaded.format() === 'fastg' ? 'fastg' : 'gfa';
  const result: ParseResult = {
    format,
    version: loaded.version(),
    gzip,
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

async function handle(request: ParseRequest): Promise<void> {
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

self.addEventListener('message', (event: MessageEvent<ParseRequest>) => {
  void handle(event.data);
});
