import type { LabelMetrics, PlacedLabels, View } from '../core/backend';

type Placement = View & LabelMetrics;

/** Where label anchors are read from. */
export interface Chains {
  /** `x, y` per point. */
  positions: Float32Array;
  /** First point of each segment's chain. */
  starts: Uint32Array;
  /** Pieces in each segment's chain. */
  pieces: Uint8Array;
}

/** Mirrors `anchor` in labels.wgsl: the midpoint of a segment's chain. */
export function anchor(c: Chains, segment: number): [number, number] {
  const start = c.starts[segment] ?? 0;
  const pieces = c.pieces[segment] ?? 0;
  const mid = start + (pieces >>> 1);
  const other = mid + (pieces % 2);
  return [
    0.5 * ((c.positions[mid * 2] ?? 0) + (c.positions[other * 2] ?? 0)),
    0.5 * ((c.positions[mid * 2 + 1] ?? 0) + (c.positions[other * 2 + 1] ?? 0)),
  ];
}

interface Claim {
  segment: number;
  key: number;
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}

/**
 * The rule of labels.wgsl on the CPU: each candidate claims the screen cells
 * its label box covers with its priority, and keeps its label only if it won
 * every one of them, so labels never overlap and the winners are the GPU's.
 * `sizes` holds per segment its rank, then `chars | lines << 16` (0 for no label).
 */
export function placeLabels(
  chains: Chains,
  sizes: Uint32Array,
  candidates: Iterable<number>,
  at: Placement,
): PlacedLabels {
  const n = chains.starts.length;
  const columns = Math.max(1, Math.ceil(at.width / at.cell));
  const rows = Math.max(1, Math.ceil(at.height / at.cell));
  const cells = new Uint32Array(columns * rows);
  const claims: Claim[] = [];
  for (const segment of candidates) {
    const size = sizes[n + segment] ?? 0;
    if (size === 0) continue;
    const [x, y] = anchor(chains, segment);
    const sx = (x - at.centerX) * at.zoom + at.width * 0.5;
    const sy = (y - at.centerY) * at.zoom + at.height * 0.5;
    const hx = (size & 0xffff) * at.advance * 0.5;
    const hy = (size >>> 16) * at.lineHeight * 0.5;
    if (sx + hx < 0 || sy + hy < 0 || sx - hx >= at.width || sy - hy >= at.height) continue;
    const col = (v: number) => Math.min(columns - 1, Math.max(0, Math.floor(v / at.cell)));
    const row = (v: number) => Math.min(rows - 1, Math.max(0, Math.floor(v / at.cell)));
    const claim = {
      segment,
      key: 0xffffffff - (sizes[segment] ?? 0),
      c0: col(sx - hx),
      r0: row(sy - hy),
      c1: col(sx + hx),
      r1: row(sy + hy),
    };
    claims.push(claim);
    for (let r = claim.r0; r <= claim.r1; r++) {
      for (let c = claim.c0; c <= claim.c1; c++) {
        const k = r * columns + c;
        if (claim.key > (cells[k] ?? 0)) cells[k] = claim.key;
      }
    }
  }
  const won = claims.filter((claim) => {
    for (let r = claim.r0; r <= claim.r1; r++) {
      for (let c = claim.c0; c <= claim.c1; c++) if (cells[r * columns + c] !== claim.key) return false;
    }
    return true;
  });
  const ranks = won.map((claim) => sizes[claim.segment] ?? 0);
  const order = won.map((_, i) => i).sort((a, b) => (ranks[a] ?? 0) - (ranks[b] ?? 0));
  return {
    segments: Uint32Array.from(order, (i) => won[i]?.segment ?? 0),
    ranks: Uint32Array.from(order, (i) => ranks[i] ?? 0),
  };
}
