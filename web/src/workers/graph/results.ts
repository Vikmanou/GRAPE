import type { Loaded } from '../../wasm/pkg/gfa_wasm';
import { plain } from '../plain';
import type { ParseResult, SegmentAttributes } from '../protocol/graph';
import type { GfaRecords, SequenceSource } from '../protocol/sequence';
import type { Compression } from './readFile';

export function resultTransfers({ components, warnings, topology, attributes }: ParseResult): Transferable[] {
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

export function attributeTransfers({ depth, gc, tagColors, tagColors2 }: SegmentAttributes): ArrayBuffer[] {
  return [depth, gc, tagColors.segments, tagColors.colors, tagColors2.segments, tagColors2.colors].map((a) => a.buffer);
}

/**
 * Moves the sequences out to hand to the sequence worker; packed bases leave
 * this worker. `file` holds the sequences, and lines only when it is the graph's own file.
 */
export function sequenceSource(loaded: Loaded, file: File, compression: Compression, ownFile = true): SequenceSource {
  const lengths = plain(loaded.segmentLengths());
  const offsets = plain(loaded.sequenceOffsets());
  const flags = plain(loaded.segmentFlags());
  if (compression === 'none')
    return {
      kind: 'file',
      file,
      lengths,
      offsets,
      flags,
      lines: ownFile ? plain(loaded.lineOffsets()) : new Float64Array(0),
    };
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

export function describe(loaded: Loaded, compression: Compression, parseMs: number): ParseResult {
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

export function gfaRecords(loaded: Loaded): GfaRecords {
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
