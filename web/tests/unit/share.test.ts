import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY } from '../../src/engine/style/display';
import { DEFAULT_LABELS } from '../../src/state/labels';
import { isPackedFragment, packedFragment, packedPayload, ShareLinkError } from '../../src/state/share/codec';
import { HASHED_BYTES, headHash, sameFile } from '../../src/state/share/fingerprint';
import { parseShareState, type ShareState } from '../../src/state/share/state';

const state: ShareState = {
  file: { size: 1234, segments: 56, sha256: 'ab'.repeat(32) },
  layout: { seed: 7, quality: 'best', kind: 'gpu' },
  merged: true,
  camera: { x: -12.5, y: 300, zoom: 0.25 },
  display: { ...DEFAULT_DISPLAY, color: 'depth', range: { scale: 'log', min: 0.5, max: 40 }, double: true },
  labels: { ...DEFAULT_LABELS, show: true, content: { custom: false, name: true, length: true, depth: false } },
  filters: { minComponentLength: 1000, depth: { min: 2, max: 9 } },
  selection: ['1', 'contig_2', 'é?#&'],
  paths: ['chr1'],
};

describe('share state', () => {
  it('wrap a packed payload with its version and refuse another', () => {
    const fragment = packedFragment('abc-_');
    expect(fragment).toBe('#g=1.abc-_');
    expect(isPackedFragment(fragment)).toBe(true);
    expect(packedPayload(fragment)).toBe('abc-_');
    expect(() => packedPayload('#g=2.abc')).toThrow('newer version');
  });

  it('keep a view through JSON unchanged', () => {
    expect(parseShareState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('keep defaults for fields a crafted link gets wrong, and refuse one without a file', () => {
    const parsed = parseShareState({
      file: { size: 1, segments: 2, sha256: 'x' },
      layout: { seed: -1, quality: 'turbo', kind: 'quantum' },
      camera: { x: 1, y: 2, zoom: -3 },
      display: { color: 'rainbow', range: { scale: 'cubic', min: 'a', max: 3 } },
      selection: ['a', 3, null],
      paths: 'chr1',
    });
    expect(parsed.layout).toEqual({ seed: 0xffffffff, quality: 'balanced', kind: 'gpu' });
    expect(parsed.camera).toBeUndefined();
    expect(parsed.display.color).toBe(DEFAULT_DISPLAY.color);
    expect(parsed.display.range).toEqual({ scale: 'linear', min: DEFAULT_DISPLAY.range.min, max: 3 });
    expect(parsed.selection).toEqual(['a']);
    expect(parsed.paths).toEqual([]);
    expect(() => parseShareState({ layout: {} })).toThrow(ShareLinkError);
  });

  it('fingerprint a file by its first mebibyte', async () => {
    expect(await headHash(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const head = new Uint8Array(HASHED_BYTES).fill(7);
    const a = await headHash(new Blob([head, 'tail one']));
    expect(await headHash(new Blob([head, 'tail two']))).toBe(a);
    const print = { size: 10, segments: 2, sha256: a };
    expect(sameFile(print, { ...print })).toBe(true);
    expect(sameFile(print, { ...print, segments: 3 })).toBe(false);
  });
});
