import { describe, expect, it } from 'vitest';
import type { SequenceSource } from '../../src/workers/protocol/sequence';
import { type Core, Sequences } from '../../src/workers/sequence/Sequences';

const long = 'ACGT'.repeat(75);
const text = `H\tVN:Z:1.0\nS\ta\t${long}\tLN:i:300\nS\tb\tGGCC\nS\tc\t*\tLN:i:9\r\n`;
const start = (s: string) => text.indexOf(s);

const core: Core = {
  basesFromFile: (bytes, length) => (bytes.length >= length ? bytes.slice(0, length) : undefined),
  packedBases: undefined,
};

function plainFile(): Sequences {
  const source: SequenceSource = {
    kind: 'file',
    file: new File([text], 'g.gfa'),
    lengths: Uint32Array.from([300, 4, 9]),
    offsets: Float64Array.from([start(long), start('GGCC'), -1]),
    flags: Uint8Array.from([2, 2, 0]),
    lines: Float64Array.from([start('S\ta'), start('S\tb'), start('S\tc')]),
  };
  return new Sequences(source, core);
}

describe('Sequences', () => {
  it('previews the ends of a long sequence and all of a short one', async () => {
    const s = plainFile();
    expect(await s.preview(0, 100)).toEqual({ head: long.slice(0, 100), tail: long.slice(200) });
    expect(await s.preview(1, 100)).toEqual({ head: 'GGCC', tail: '' });
    expect(await s.preview(2, 100)).toBeUndefined();
  });

  it('reads raw lines, cutting the middle of a long sequence', async () => {
    const s = plainFile();
    expect(await s.rawLine(0, 100)).toEqual({
      text: `S\ta\t${long.slice(0, 100)}…${long.slice(200)}\tLN:i:300`,
      elided: 100,
    });
    expect(await s.rawLine(1, 100)).toEqual({ text: 'S\tb\tGGCC', elided: 0 });
    expect(await s.rawLine(2, 100)).toEqual({ text: 'S\tc\t*\tLN:i:9', elided: 0 });
  });

  it('has nothing to read once sequences were dropped', async () => {
    const s = new Sequences({ kind: 'dropped' }, core);
    expect(s.available).toBe(false);
    expect(await s.bases(0)).toBeUndefined();
    expect(await s.rawLine(0, 100)).toBeUndefined();
  });
});
