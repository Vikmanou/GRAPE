import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, isGzip, readFile } from '../../src/workers/readFile';

function testdata(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`../../../testdata/${name}`, import.meta.url)));
}

async function collect(blob: Blob): Promise<{ text: string; progress: number[] }> {
  const parts: Uint8Array[] = [];
  const progress: number[] = [];
  await readFile(blob, await isGzip(blob), (c) => parts.push(c), (n) => progress.push(n));
  return { text: Buffer.concat(parts).toString('utf8'), progress };
}

describe('readFile', () => {
  it('reads plain files in fixed chunks with progress up to the size', async () => {
    const big = 'S\t1\tACGT\n'.repeat(Math.ceil((CHUNK_BYTES * 2.5) / 9));
    const { text, progress } = await collect(new Blob([big]));
    expect(text).toBe(big);
    expect(progress).toHaveLength(3);
    expect(progress.at(-1)).toBe(big.length);
  });

  it('detects and decompresses gzip', async () => {
    const plain = testdata('linear.gfa');
    const gz = new Blob([testdata('linear.gfa.gz')]);
    expect(await isGzip(gz)).toBe(true);
    expect(await isGzip(new Blob([plain]))).toBe(false);
    const { text, progress } = await collect(gz);
    expect(text).toBe(Buffer.from(plain).toString('utf8'));
    expect(progress.at(-1)).toBe(gz.size);
  });

  it('reads every member of a multi-member gzip file', async () => {
    const { text } = await collect(new Blob([testdata('two_members.gfa.gz')]));
    expect(text).toBe(Buffer.from(testdata('bubble.gfa')).toString('utf8'));
  });

  it('rejects corrupt gzip', async () => {
    const gz = gzipSync('S\t1\tACGT\n'.repeat(1000));
    const corrupt = new Blob([gz.subarray(0, gz.length - 20)]);
    await expect(collect(corrupt)).rejects.toThrow();
  });
});
