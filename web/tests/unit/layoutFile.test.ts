import { describe, expect, it } from 'vitest';
import { readLayout, writeLayout } from '../../src/workers/graph/layoutFile';

// Two segments: `a` draws points 0..2, `b` points 3..4.
const names = ['a', 'b'];
const chains = Uint32Array.of(0, 2, 3, 1);
const positions = Float32Array.of(0, 0, 1.5, 0, 3, 0, 10, -2, 12, -2);
const index = new Map(names.map((n, i) => [n, i]));

describe('BandageNG layout files', () => {
  it('write node names with their strand and every line point, and read them back', async () => {
    const text = await writeLayout(names, chains, positions, 'layout', false).text();
    expect(JSON.parse(text)).toEqual({
      'a+': [
        [0, 0],
        [1.5, 0],
        [3, 0],
      ],
      'b+': [
        [10, -2],
        [12, -2],
      ],
    });
    expect(text.startsWith('{\n    "a+": [\n        [\n            0,')).toBe(true);
    const lines = readLayout(text, index, 2);
    expect(Array.from(lines.starts)).toEqual([0, 3, 5]);
    expect(lines.points).toEqual(positions);
  });

  it('write both strands in double mode, the reverse strand backwards', async () => {
    const parsed = JSON.parse(await writeLayout(names, chains, positions, 'layout', true).text()) as Record<
      string,
      number[][]
    >;
    expect(parsed['b-']).toEqual([
      [12, -2],
      [10, -2],
    ]);
  });

  it('write TSV as the middle point of each line at six significant digits', async () => {
    const text = await writeLayout(
      names,
      chains,
      Float32Array.of(0, 0, 1234567, 0.0000123, 3, 0, 1, 2, 3, 4),
      'tsv',
      false,
    ).text();
    expect(text).toBe('a+\t1.23457e+06\t1.23e-05\nb+\t1\t2\n');
  });

  it('take a reverse strand alone backwards and leave out nodes the file lacks', () => {
    const lines = readLayout('{"b-": [[5, 5], [1, 1]]}', index, 2);
    expect(Array.from(lines.starts)).toEqual([0, 0, 2]);
    expect(Array.from(lines.points)).toEqual([1, 1, 5, 5]);
  });

  it('refuse what BandageNG refuses, with its messages', () => {
    expect(() => readLayout('{"c+": []}', index, 2)).toThrow('graph does not contain node: c+');
    expect(() => readLayout('{"a": []}', index, 2)).toThrow('graph does not contain node: a');
    expect(() => readLayout('[]', index, 2)).toThrow('invalid layout format');
    expect(() => readLayout('{"a+": [[1, 2, 3]]}', index, 2)).toThrow('invalid layout format: point size is 3');
    expect(() => readLayout('not json', index, 2)).toThrow('This is not a layout file');
  });
});
