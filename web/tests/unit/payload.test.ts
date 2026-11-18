import { describe, expect, it } from 'vitest';
import { base64url, fromBase64url } from '../../src/workers/shared/base64url';
import { joinParts, PayloadError, splitParts } from '../../src/workers/pack/payload';

describe('packed link payload', () => {
  it('splits back into the parts it was joined from', () => {
    const big = new Uint8Array(70_000).map((_, i) => i % 251);
    const parts = [
      { kind: 'view' as const, name: '', bytes: new Uint8Array([1, 2, 3]) },
      { kind: 'graph' as const, name: 'assembly é.gfa', bytes: big },
      { kind: 'fasta' as const, name: 'reads.fa', bytes: new Uint8Array() },
    ];
    const back = splitParts(fromBase64url(base64url(joinParts(parts))));
    expect(back.map((p) => [p.kind, p.name, p.bytes.length])).toEqual(
      parts.map((p) => [p.kind, p.name, p.bytes.length]),
    );
    expect(back[1]?.bytes).toEqual(big);
  });

  it('refuses a cut or unknown payload', () => {
    const joined = joinParts([{ kind: 'graph', name: 'g.gfa', bytes: new Uint8Array(100) }]);
    expect(() => splitParts(joined.subarray(0, 50))).toThrow(PayloadError);
    expect(() => splitParts(new Uint8Array([9, 0, 0]))).toThrow(PayloadError);
  });

  it('uses only URL-safe characters', () => {
    expect(base64url(new Uint8Array([251, 255, 191]))).toBe('-_-_');
  });
});
