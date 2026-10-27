import type { Loaded } from '../../wasm/pkg/gfa_wasm';
import { plain } from '../plain';
import type { SegmentInfo, SegmentLink, SelectionSummary } from '../protocol/graph';
import type { FastaRecords } from '../protocol/sequence';
import { compileFindRegex, type FindQuery } from './findQuery';

/** Links listed in the info panel; a tangle can have thousands. */
const INFO_LINKS = 100;
/** `seg_flags::DEFINED` in gfa-core store/segments.rs. */
const DEFINED = 1;

export function segmentInfo(loaded: Loaded, segment: number): SegmentInfo | undefined {
  const info = loaded.info(segment, INFO_LINKS);
  if (!info) return undefined;
  const raw = info.links();
  const others = Uint32Array.from({ length: raw.length / 5 }, (_, i) => raw[i * 5] ?? 0);
  const otherNames = loaded.names(others);
  const links: SegmentLink[] = Array.from(others, (other, i) => ({
    other,
    otherName: otherNames[i] ?? '',
    from: raw[i * 5 + 1] ?? 0,
    fromReverse: raw[i * 5 + 2] === 1,
    to: raw[i * 5 + 3] ?? 0,
    toReverse: raw[i * 5 + 4] === 1,
  }));
  const result: SegmentInfo = {
    segment,
    name: loaded.names(Uint32Array.of(segment))[0] ?? '',
    length: info.length(),
    depth: info.depth(),
    gc: info.gc(),
    component: info.component(),
    degreeStart: info.degreeStart(),
    degreeEnd: info.degreeEnd(),
    links,
    totalLinks: info.totalLinks(),
  };
  info.free();
  return result;
}

export function summary(loaded: Loaded, bits: Uint32Array): SelectionSummary {
  const [count = 0, totalLength = 0, meanDepth = NaN] = loaded.selectionSummary(bits);
  return { count, totalLength, meanDepth };
}

export function find(loaded: Loaded, query: FindQuery): { segments: Uint32Array<ArrayBuffer>; missing: string[] } {
  if (query.kind === 'names') {
    const found = loaded.findNames(query.names);
    const result = { segments: plain(found.ids()), missing: found.missing() };
    found.free();
    return result;
  }
  const regex = compileFindRegex(query.source);
  const flags = loaded.segmentFlags();
  const matches: number[] = [];
  forEachName(loaded, (id, name) => {
    if ((flags[id] ?? 0) & DEFINED && regex.test(name)) matches.push(id);
  });
  return { segments: Uint32Array.from(matches), missing: [] };
}

export function exportRecords(loaded: Loaded, segments: Uint32Array): FastaRecords {
  const ordered = plain(loaded.exportOrder(segments));
  return { segments: ordered, names: loaded.names(ordered), depths: plain(loaded.depths(ordered)) };
}

/** Decodes the name arena once; ASCII names, the usual case, are sliced from one string. */
function forEachName(loaded: Loaded, visit: (id: number, name: string) => void): void {
  const bytes = loaded.nameBytes();
  const ends = loaded.nameEnds();
  const ascii = bytes.every((b) => b < 0x80);
  const decoder = new TextDecoder();
  const all = ascii ? decoder.decode(bytes) : '';
  let start = 0;
  for (const [id, end] of ends.entries()) {
    visit(id, ascii ? all.slice(start, end) : decoder.decode(bytes.subarray(start, end)));
    start = end;
  }
}
