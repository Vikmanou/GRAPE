import { describe, expect, it } from 'vitest';
import { MAX_QUERY_BASES, parseQueries } from '../../src/workers/sequence/queries';

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe('parseQueries', () => {
  it('reads bare bases as one query, whatever the case and line ends', () => {
    const { queries } = parseQueries('acgt ACGT\r\nuuNN\n', 4);
    expect(queries.map((q) => [q.name, text(q.bases)])).toEqual([['Query 1', 'ACGTACGTTTNN']]);
  });

  it('reads FASTA records, naming each by the first word of its header', () => {
    const { queries } = parseQueries('>first gene one\nACGT\nACGT\n\n>second\nGGGG\n', 4);
    expect(queries.map((q) => [q.name, text(q.bases)])).toEqual([
      ['first', 'ACGTACGT'],
      ['second', 'GGGG'],
    ]);
  });

  it('sets aside queries shorter than a seed, and fails when none is left', () => {
    const { queries, tooShort } = parseQueries('>a\nACGT\n>b\nACGTACGT', 8);
    expect(queries.map((q) => q.name)).toEqual(['b']);
    expect(tooShort).toEqual(['a']);
    expect(() => parseQueries('>a\nACGT', 8)).toThrow(/at least 8 bases/);
  });

  it('refuses protein, other letters, nothing at all and oversized queries', () => {
    expect(() => parseQueries('>p\nMKVLAAGIVGLLLAQWE', 4)).toThrow(/p looks like protein .*letter L.*DNA only/);
    expect(() => parseQueries('ACGT-ACGT', 4)).toThrow(/"-"/);
    expect(() => parseQueries(' \n', 4)).toThrow(/no sequence/);
    expect(() => parseQueries('A'.repeat(MAX_QUERY_BASES + 1), 4)).toThrow(/more than one query/);
  });
});
