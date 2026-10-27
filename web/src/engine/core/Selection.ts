/** One bit per segment; the engine owns the selection and mirrors it to the store. */
export class Selection {
  private bits = new Uint32Array(0);
  private limit = 0;
  private size = 0;

  /** Starts over, empty, for a graph of `segments` segments. */
  reset(segments: number): void {
    this.bits = new Uint32Array(Math.ceil(segments / 32));
    this.limit = segments;
    this.size = 0;
  }

  get segments(): number {
    return this.limit;
  }

  get count(): number {
    return this.size;
  }

  /** The one selected segment, if exactly one is. */
  get single(): number | undefined {
    if (this.size !== 1) return undefined;
    for (const [w, word] of this.bits.entries()) {
      if (word !== 0) return w * 32 + (31 - Math.clz32(word & -word));
    }
    return undefined;
  }

  has(segment: number): boolean {
    return ((this.bits[segment >>> 5] ?? 0) >>> (segment & 31)) & 1 ? true : false;
  }

  replace(segments: Iterable<number>): void {
    this.bits.fill(0);
    this.size = 0;
    this.add(segments);
  }

  add(segments: Iterable<number>): void {
    for (const s of segments) if (s < this.limit && !this.has(s)) this.flip(s);
  }

  /** Adds every set bit of `other`, a bitset over the same segments. */
  addBits(other: Uint32Array): void {
    for (let w = 0; w < this.bits.length; w++) this.bits[w] = (this.bits[w] ?? 0) | (other[w] ?? 0);
    this.recount();
  }

  toggle(segment: number): void {
    if (segment < this.limit) this.flip(segment);
  }

  clear(): void {
    this.bits.fill(0);
    this.size = 0;
  }

  invert(): void {
    for (let w = 0; w < this.bits.length; w++) this.bits[w] = ~(this.bits[w] ?? 0);
    const tail = this.limit & 31;
    if (tail) this.bits[this.bits.length - 1] = (this.bits[this.bits.length - 1] ?? 0) & ((1 << tail) - 1);
    this.size = this.limit - this.size;
  }

  /** A copy of the bits, to hand to the GPU or the store. */
  snapshot(): Uint32Array<ArrayBuffer> {
    return this.bits.slice();
  }

  private flip(segment: number): void {
    const w = segment >>> 5;
    const bit = 1 << (segment & 31);
    const word = this.bits[w] ?? 0;
    this.bits[w] = word ^ bit;
    this.size += word & bit ? -1 : 1;
  }

  private recount(): void {
    let n = 0;
    for (const word of this.bits) n += popcount(word);
    this.size = n;
  }
}

function popcount(x: number): number {
  let v = x - ((x >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24) & 0xff;
}
