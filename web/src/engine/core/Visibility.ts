/** Steps from the selection at which a segment counts as unreached. */
export const UNREACHED = 255;

/** What a filter hides; segments it does not name stay shown. */
export interface Filter {
  /** Steps from the selection per segment, `UNREACHED` beyond the search, and the most steps shown. */
  neighbourhood?: { distances: Uint8Array; steps: number } | undefined;
  /** 1 per component rank shown. */
  components?: Uint8Array | undefined;
  /** Components shorter than this many bases hide; each component's total length by rank. */
  minComponentLength?: { bases: number; lengths: Float64Array } | undefined;
  /** Segments of unknown depth stay shown. */
  depth?: { min: number; max: number } | undefined;
}

export const NO_FILTER: Filter = {};

export interface FilterData {
  components: Uint32Array;
  /** NaN when unknown. */
  depth: Float32Array;
  linkFrom: Uint32Array;
  linkTo: Uint32Array;
}

/** One bit per hidden segment and per hidden link, and how many segments stay shown. */
export interface Hidden {
  segments: Uint32Array<ArrayBuffer>;
  links: Uint32Array<ArrayBuffer>;
  visible: number;
}

export function filtering(filter: Filter): boolean {
  return !!(filter.neighbourhood ?? filter.components ?? filter.minComponentLength ?? filter.depth);
}

function shown(filter: Filter, data: FilterData, segment: number): boolean {
  const { neighbourhood, components, minComponentLength, depth } = filter;
  if (neighbourhood && (neighbourhood.distances[segment] ?? UNREACHED) > neighbourhood.steps) return false;
  const component = data.components[segment] ?? 0;
  if (components && !components[component]) return false;
  if (minComponentLength && (minComponentLength.lengths[component] ?? 0) < minComponentLength.bases) return false;
  const d = data.depth[segment] ?? NaN;
  return !depth || Number.isNaN(d) || (d >= depth.min && d <= depth.max);
}

/** A link hides with either of its segments. */
export function hiddenBy(filter: Filter, data: FilterData): Hidden {
  const n = data.components.length;
  const segments = new Uint32Array(Math.ceil(n / 32));
  const links = new Uint32Array(Math.ceil(data.linkFrom.length / 32));
  if (!filtering(filter)) return { segments, links, visible: n };
  let visible = 0;
  for (let s = 0; s < n; s++) {
    if (shown(filter, data, s)) visible++;
    else segments[s >>> 5] = (segments[s >>> 5] ?? 0) | (1 << (s & 31));
  }
  const isHidden = (s: number) => ((segments[s >>> 5] ?? 0) >>> (s & 31)) & 1;
  for (let l = 0; l < data.linkFrom.length; l++) {
    if (isHidden(data.linkFrom[l] ?? 0) || isHidden(data.linkTo[l] ?? 0)) {
      links[l >>> 5] = (links[l >>> 5] ?? 0) | (1 << (l & 31));
    }
  }
  return { segments, links, visible };
}

/** `bits` without the hidden segments. */
export function withoutHidden(bits: Uint32Array<ArrayBuffer>, hidden: Uint32Array): Uint32Array<ArrayBuffer> {
  return bits.map((word, i) => word & ~(hidden[i] ?? 0));
}

/** Label sizes, per segment its rank then its box, with no box for hidden segments. */
export function shownLabelSizes(sizes: Uint32Array<ArrayBuffer>, hidden: Uint32Array): Uint32Array<ArrayBuffer> {
  const n = sizes.length / 2;
  const out = sizes.slice();
  hidden.forEach((word, w) => {
    for (let rest = word, b = 0; rest !== 0; b++, rest >>>= 1) {
      if (rest & 1 && w * 32 + b < n) out[n + w * 32 + b] = 0;
    }
  });
  return out;
}
