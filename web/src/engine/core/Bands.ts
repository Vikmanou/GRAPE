import type { Geometry } from '../../workers/protocol/layout';
import type { Backend } from './backend';

/** Search hits to draw on the ribbons, one entry per part of a hit. */
export interface HitBands {
  segments: Uint32Array<ArrayBuffer>;
  /** 1 where the hit is on the reverse strand, which only that strand shows in double mode. */
  reverse: Uint8Array<ArrayBuffer>;
  /** Fractions along the segment's forward strand. */
  starts: Float32Array<ArrayBuffer>;
  ends: Float32Array<ArrayBuffer>;
  /** RGBA8. */
  colors: Uint32Array<ArrayBuffer>;
}

/** `point, segment, from, to, colour, reverse` and padding per instance, as `band_vertex` in graph.wgsl reads them. */
export const BAND_WORDS = 8;

/**
 * One instance per ribbon piece a band crosses. A base's place along the
 * ribbon goes by piece, not by arc length: pieces share a rest length, so the
 * two agree once a layout settles, and this needs no work as points move.
 */
export function bandInstances(
  bands: HitBands,
  segmentStarts: Uint32Array,
  segmentPieces: Uint8Array,
): Uint32Array<ArrayBuffer> {
  const pieces = (i: number) => segmentPieces[bands.segments[i] ?? 0] ?? 1;
  const span = (i: number) => {
    const n = pieces(i);
    const first = Math.min(n - 1, Math.floor((bands.starts[i] ?? 0) * n));
    const last = Math.max(first, Math.min(n - 1, Math.ceil((bands.ends[i] ?? 0) * n) - 1));
    return [n, first, last] as const;
  };
  let total = 0;
  for (let i = 0; i < bands.segments.length; i++) {
    const [, first, last] = span(i);
    total += last - first + 1;
  }
  const words = new Uint32Array(total * BAND_WORDS);
  const floats = new Float32Array(words.buffer);
  let at = 0;
  for (let i = 0; i < bands.segments.length; i++) {
    const segment = bands.segments[i] ?? 0;
    const start = segmentStarts[segment] ?? 0;
    const [n, first, last] = span(i);
    for (let p = first; p <= last; p++) {
      words[at] = start + p;
      words[at + 1] = segment;
      floats[at + 2] = p === first ? (bands.starts[i] ?? 0) * n - p : 0;
      floats[at + 3] = p === last ? (bands.ends[i] ?? 0) * n - p : 1;
      words[at + 4] = bands.colors[i] ?? 0;
      words[at + 5] = bands.reverse[i] ?? 0;
      at += BAND_WORDS;
    }
  }
  return words;
}

/** Keeps the backend drawing the current hits, through new layouts of the same graph. */
export class Bands {
  private hits: HitBands | undefined;
  private geometry: Pick<Geometry, 'segmentStarts' | 'segmentPieces' | 'segments'> | undefined;

  constructor(private readonly backend: Backend) {}

  setGeometry(geometry: Geometry): void {
    this.geometry = geometry;
    this.apply();
  }

  set(hits: HitBands | undefined): void {
    this.hits = hits;
    this.apply();
  }

  private apply(): void {
    const { hits, geometry } = this;
    if (!geometry) return;
    const inRange = hits?.segments.every((s) => s < geometry.segments) ?? false;
    this.backend.setBands(
      hits && inRange ? bandInstances(hits, geometry.segmentStarts, geometry.segmentPieces) : new Uint32Array(0),
    );
  }
}
