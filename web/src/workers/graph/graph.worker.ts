// Owns the WASM module, so parsing never blocks the main thread.

import init, { coreVersion, type Loaded, Parser } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import { plain } from '../plain';
import type { GraphRequest, GraphResponse, ParseResult, SegmentAttributes } from '../protocol/graph';
import {
  type ChainMap,
  chainTransfers,
  type GfaRecords,
  type SequenceSource,
  sourceTransfers,
} from '../protocol/sequence';
import { exportRecords, find, segmentInfo, summary } from './queries';
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

async function parse(id: number, file: File): Promise<void> {
  current?.free();
  current = undefined;
  merged?.loaded.free();
  merged = undefined;
  showMerged = false;
  const start = performance.now();
  compression = await detectCompression(file);
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
  const sequences = sequenceSource(current, file, compression);
  post({ type: 'parsed', id, result, sequences }, [...sourceTransfers(sequences), ...resultTransfers(result)]);
}

function resultTransfers({ components, warnings, topology, attributes }: ParseResult): Transferable[] {
  return [
    components.segments.buffer,
    components.lengths.buffer,
    components.meanDepths.buffer,
    components.circular.buffer,
    warnings.lines.buffer,
    warnings.severities.buffer,
    topology.lengths.buffer,
    topology.components.buffer,
    topology.linkFrom.buffer,
    topology.linkTo.buffer,
    topology.linkBits.buffer,
    ...attributeTransfers(attributes),
  ];
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

function gfaRecords(loaded: Loaded): GfaRecords {
  const segments = plain(loaded.gfaOrder());
  const lengths = loaded.segmentLengths();
  return {
    segments,
    names: loaded.names(segments),
    lengths: Uint32Array.from(segments, (s) => lengths[s] ?? 0),
    depths: plain(loaded.depths(segments)),
    custom: loaded.gfaCustom(segments),
    depthTag: loaded.depthTag(),
    links: plain(loaded.gfaLinks()),
  };
}

function attributeTransfers({ depth, gc, tagColors, tagColors2 }: SegmentAttributes): ArrayBuffer[] {
  return [depth, gc, tagColors.segments, tagColors.colors, tagColors2.segments, tagColors2.colors].map((a) => a.buffer);
}

/** Moves the sequences out to hand to the sequence worker; packed bases leave this worker. */
function sequenceSource(loaded: Loaded, file: File, compression: Compression): SequenceSource {
  const lengths = plain(loaded.segmentLengths());
  const offsets = plain(loaded.sequenceOffsets());
  const flags = plain(loaded.segmentFlags());
  if (compression === 'none')
    return { kind: 'file', file, lengths, offsets, flags, lines: plain(loaded.lineOffsets()) };
  const parts = loaded.takePacked();
  if (!parts) return { kind: 'dropped' };
  const packed = {
    bits: plain(parts.bits()),
    bases: parts.bases(),
    runStarts: plain(parts.runStarts()),
    runLengths: plain(parts.runLengths()),
    runBytes: plain(parts.runBytes()),
    lowerStarts: plain(parts.lowerStarts()),
    lowerLengths: plain(parts.lowerLengths()),
  };
  parts.free();
  return { kind: 'packed', packed, lengths, offsets, flags };
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
      depthQ1: s.depthQ1,
      depthQ3: s.depthQ3,
      depthMin: s.depthMin,
      depthMax: s.depthMax,
      gcMin: s.gcMin,
      gcMax: s.gcMax,
    },
    components: {
      segments: loaded.componentSegments(),
      lengths: loaded.componentLengths(),
      meanDepths: loaded.componentMeanDepths(),
      circular: loaded.componentCircular(),
    },
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
    attributes: {
      depth: plain(loaded.segmentDepths()),
      gc: plain(loaded.segmentGc()),
      tagColors: { segments: plain(loaded.tagColorSegments(false)), colors: plain(loaded.tagColors(false)) },
      tagColors2: { segments: plain(loaded.tagColorSegments(true)), colors: plain(loaded.tagColors(true)) },
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
