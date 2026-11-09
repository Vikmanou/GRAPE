import { describe, expect, it } from 'vitest';
import { readSession, writeSession } from '../../src/workers/graph/session';
import { isSessionFile } from '../../src/state/sharing';

describe('session files', () => {
  it('keep every position bit for bit, gzipped', async () => {
    const n = 40_000;
    const positions = Float32Array.from({ length: n * 2 }, (_, i) => Math.sin(i) * 1e5 + i / 7);
    const view = { file: { size: 1, segments: 2, sha256: 'x' }, note: 'é' };
    const blob = await writeSession(view, positions.slice());
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    expect([head[0], head[1]]).toEqual([0x1f, 0x8b]);
    const read = await readSession(blob);
    expect(read.view).toEqual(view);
    expect(new Uint32Array(read.positions.buffer)).toEqual(new Uint32Array(positions.buffer));
  });

  it('refuse files that are not sessions of this version, or whose positions are cut', async () => {
    await expect(readSession(new Blob(['S\ta\tACGT\n']))).rejects.toThrow('not a GRAPE session file');
    const newer = JSON.stringify({ grape: 'session', version: 2, view: {}, positions: {} });
    await expect(readSession(new Blob([newer]))).rejects.toThrow('newer version');
    const text = await new Response(
      (await writeSession({}, new Float32Array([1, 2, 3, 4]))).stream().pipeThrough(new DecompressionStream('gzip')),
    ).text();
    const cut = text.replace(/"data":"[^"]{4}/, '"data":"');
    await expect(readSession(new Blob([cut]))).rejects.toThrow('damaged');
  });

  it('are told from graphs by name', () => {
    expect(isSessionFile('assembly.grape.json.gz')).toBe(true);
    expect(isSessionFile('a.GRAPE.JSON')).toBe(true);
    expect(isSessionFile('assembly.gfa.gz')).toBe(false);
  });
});
