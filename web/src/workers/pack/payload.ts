// What a packed share link holds once base64url is undone: parts in a row,
// each a kind byte, a varint name length, the name in UTF-8, a varint data
// length and the data (each part packed by gfa-core's `pack`).

export type PartKind = 'view' | 'graph' | 'fasta';
const KINDS: PartKind[] = ['view', 'graph', 'fasta'];

export interface Part {
  kind: PartKind;
  name: string;
  bytes: Uint8Array;
}

export class PayloadError extends Error {}

function putVarint(out: number[], value: number): void {
  let v = value;
  while (v >= 0x80) {
    out.push(v % 0x80 | 0x80);
    v = Math.floor(v / 0x80);
  }
  out.push(v);
}

export function joinParts(parts: Part[]): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const heads = parts.map((p) => {
    const name = encoder.encode(p.name);
    const head: number[] = [KINDS.indexOf(p.kind)];
    putVarint(head, name.length);
    head.push(...name);
    putVarint(head, p.bytes.length);
    return head;
  });
  const out = new Uint8Array(parts.reduce((n, p, i) => n + (heads[i]?.length ?? 0) + p.bytes.length, 0));
  let at = 0;
  parts.forEach((p, i) => {
    const head = heads[i] ?? [];
    out.set(head, at);
    out.set(p.bytes, at + head.length);
    at += head.length + p.bytes.length;
  });
  return out;
}

export function splitParts(bytes: Uint8Array): Part[] {
  let at = 0;
  const varint = (): number => {
    let value = 0;
    for (let scale = 1; scale < 2 ** 49; scale *= 0x80) {
      const b = bytes[at++];
      if (b === undefined) throw new PayloadError('cut short');
      value += (b & 0x7f) * scale;
      if (b < 0x80) return value;
    }
    throw new PayloadError('bad length');
  };
  const take = (n: number): Uint8Array => {
    if (at + n > bytes.length) throw new PayloadError('cut short');
    at += n;
    return bytes.subarray(at - n, at);
  };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const parts: Part[] = [];
  while (at < bytes.length) {
    const kind = KINDS[bytes[at++] ?? -1];
    if (!kind) throw new PayloadError('unknown part');
    const name = decoder.decode(take(varint()));
    parts.push({ kind, name, bytes: take(varint()) });
  }
  return parts;
}
