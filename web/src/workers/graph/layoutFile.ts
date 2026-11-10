// BandageNG's layout files (layout/io.cpp in github.com/asl/BandageNG):
// `.layout` is a JSON object from each drawn node's name and strand to its
// line points, `[x, y]` each; `.tsv` gives one line per node, its name, then
// the middle point of its line (`(points - 1) / 2`) at Qt's default six
// significant digits. Loading reads `.layout` and refuses names the graph
// lacks, with BandageNG's messages.

import type { LayoutLines } from '../protocol/layout';

export type LayoutFormat = 'layout' | 'tsv';

/** `first point, pieces` per segment (gfa-wasm `layoutChains`). */
type Chains = Uint32Array;

/** C's `%g`, which Qt's text stream writes doubles with. */
function g6(v: number): string {
  if (v === 0 || !Number.isFinite(v)) return String(v);
  const [mantissa = '0', exponent = '0'] = v.toExponential(5).split('e');
  const e = Number(exponent);
  if (e < -4 || e >= 6) {
    const digits = String(Math.abs(e)).padStart(2, '0');
    return `${mantissa.replace(/\.?0+$/, '')}e${e < 0 ? '-' : '+'}${digits}`;
  }
  return v.toFixed(5 - e).replace(/\.?0+$/, '');
}

/** `strands`: `+` alone, or both in double mode, where `-` runs the line backwards. */
export function writeLayout(
  names: string[],
  chains: Chains,
  positions: Float32Array,
  format: LayoutFormat,
  double: boolean,
): Blob {
  const parts: string[] = [];
  const point = (p: number) => [positions[2 * p] ?? 0, positions[2 * p + 1] ?? 0] as const;
  names.forEach((name, s) => {
    const first = chains[2 * s] ?? 0;
    const pieces = chains[2 * s + 1] ?? 0;
    if (format === 'tsv') {
      const [x, y] = point(first + Math.floor(pieces / 2));
      parts.push(`${name}+\t${g6(x)}\t${g6(y)}\n`);
      return;
    }
    const line: string[] = [];
    for (let p = first; p <= first + pieces; p++) {
      const [x, y] = point(p);
      line.push(`        [\n            ${String(x)},\n            ${String(y)}\n        ]`);
    }
    const sep = parts.length === 0 ? '' : ',\n';
    parts.push(`${sep}    ${JSON.stringify(`${name}+`)}: [\n${line.join(',\n')}\n    ]`);
    if (double) parts.push(`,\n    ${JSON.stringify(`${name}-`)}: [\n${line.reverse().join(',\n')}\n    ]`);
  });
  return new Blob(format === 'tsv' ? parts : ['{\n', ...parts, '\n}\n'], {
    type: format === 'tsv' ? 'text/tab-separated-values' : 'application/json',
  });
}

function invalid(detail = ''): Error {
  return new Error(`invalid layout format${detail}`);
}

/** One line per segment; a node given on both strands keeps its `+` line, a `-` line alone runs backwards. */
export function readLayout(text: string, index: Map<string, number>, segments: number): LayoutLines {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`This is not a layout file: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw invalid();
  const lines: (number[] | undefined)[] = new Array<number[] | undefined>(segments);
  const plus = new Uint8Array(segments);
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const strand = key.at(-1);
    const segment = strand === '+' || strand === '-' ? index.get(key.slice(0, -1)) : undefined;
    if (segment === undefined) throw new Error(`graph does not contain node: ${key}`);
    if (!Array.isArray(value)) throw invalid();
    const points: number[] = [];
    for (const p of value as unknown[]) {
      if (!Array.isArray(p) || p.length !== 2)
        throw invalid(`: point size is ${String(Array.isArray(p) ? p.length : 0)}`);
      const [x, y] = p as unknown[];
      if (typeof x !== 'number' || typeof y !== 'number') throw invalid();
      points.push(x, y);
    }
    if (strand === '+') {
      lines[segment] = points;
      plus[segment] = 1;
    } else if (!plus[segment]) {
      const backwards: number[] = [];
      for (let i = points.length - 2; i >= 0; i -= 2) backwards.push(points[i] ?? 0, points[i + 1] ?? 0);
      lines[segment] = backwards;
    }
  }
  const starts = new Uint32Array(segments + 1);
  let total = 0;
  for (let s = 0; s < segments; s++) {
    total += (lines[s]?.length ?? 0) / 2;
    starts[s + 1] = total;
  }
  const points = new Float32Array(total * 2);
  for (let s = 0; s < segments; s++) {
    const line = lines[s];
    if (line) points.set(line, (starts[s] ?? 0) * 2);
  }
  return { points, starts };
}
