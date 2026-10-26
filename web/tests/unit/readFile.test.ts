import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { bgzfBlockSize, CHUNK_BYTES, detectCompression, readFile } from '../../src/workers/graph/readFile';

function testdata(name: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(new URL(`../../../testdata/${name}`, import.meta.url)));
}

const BGZF_EOF = Buffer.from('1f8b08040000000000ff0600424302001b0003000000000000000000', 'hex');

function bgzf(data: Uint8Array, blockSize: number): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += blockSize) {
    const chunk = data.subarray(i, i + blockSize);
    const deflated = deflateRawSync(chunk);
    const header = Buffer.from([0x1f, 0x8b, 8, 4, 0, 0, 0, 0, 0, 0xff, 6, 0, 66, 67, 2, 0, 0, 0]);
    header.writeUInt16LE(header.length + deflated.length + 8 - 1, 16);
    const trailer = Buffer.alloc(8);
    trailer.writeUInt32LE(crc32(chunk), 0);
    trailer.writeUInt32LE(chunk.length, 4);
    parts.push(header, deflated, trailer);
  }
  parts.push(BGZF_EOF);
  return new Uint8Array(Buffer.concat(parts));
}

async function collect(blob: Blob, chunkBytes?: number): Promise<{ text: string; progress: number[] }> {
  const parts: Uint8Array[] = [];
  const progress: number[] = [];
  const compression = await detectCompression(blob);
  await readFile(
    blob,
    compression,
    (c) => parts.push(c),
    (n) => progress.push(n),
    chunkBytes,
  );
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
    expect(await detectCompression(gz)).toBe('gzip');
    expect(await detectCompression(new Blob([plain]))).toBe('none');
    const { text, progress } = await collect(gz);
    expect(text).toBe(Buffer.from(plain).toString('utf8'));
    expect(progress.at(-1)).toBe(gz.size);
  });

  it('reads bgzip block by block, across read chunk boundaries', async () => {
    const plain = new TextEncoder().encode('S\tseg\tACGTACGTAC\tdp:f:3\n'.repeat(2000));
    const file = new Blob([bgzf(plain, 1500)]);
    expect(await detectCompression(file)).toBe('bgzf');
    const { text, progress } = await collect(file, 1000);
    expect(text.length).toBe(plain.length);
    expect(text).toBe(Buffer.from(plain).toString('utf8'));
    expect(progress.at(-1)).toBe(file.size);
  });

  it('reads the committed bgzip test file', async () => {
    const { text } = await collect(new Blob([testdata('bgzf.gfa.gz')]));
    expect(text).toBe(Buffer.from(testdata('tangle.gfa')).toString('utf8'));
  });

  it('finds the block size in the BGZF extra field', () => {
    expect(bgzfBlockSize(BGZF_EOF, 0)).toBe(28);
    expect(bgzfBlockSize(new Uint8Array(gzipSync('x')), 0)).toBeUndefined();
  });

  it('rejects a truncated bgzip file', async () => {
    const whole = bgzf(new TextEncoder().encode('S\t1\tACGT\n'.repeat(100)), 300);
    await expect(collect(new Blob([whole.subarray(0, whole.length - 40)]))).rejects.toThrow(/BGZF/);
  });

  it('rejects corrupt gzip', async () => {
    const gz = gzipSync('S\t1\tACGT\n'.repeat(1000));
    await expect(collect(new Blob([gz.subarray(0, gz.length - 20)]))).rejects.toThrow(/decompress/);
  });
});
