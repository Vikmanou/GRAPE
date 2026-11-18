/** Ids of the set bits, ascending. */
export function setBits(bits: Uint32Array): Uint32Array<ArrayBuffer> {
  const ids: number[] = [];
  for (const [w, word] of bits.entries()) {
    for (let b = 0, rest = word; rest !== 0; b++, rest >>>= 1) if (rest & 1) ids.push(w * 32 + b);
  }
  return Uint32Array.from(ids);
}
