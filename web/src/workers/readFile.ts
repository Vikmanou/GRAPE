export const CHUNK_BYTES = 4 * 1024 * 1024;

/** BGZF blocks inflated at once, to overlap the per-stream setup cost. */
const BGZF_IN_FLIGHT = 8;

export type Compression = 'none' | 'gzip' | 'bgzf';

export async function detectCompression(file: Blob): Promise<Compression> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return 'none';
  return bgzfBlockSize(head, 0) === undefined ? 'gzip' : 'bgzf';
}

/**
 * Size of the BGZF block starting at `at`, or undefined if it is not one or is
 * cut short. A BGZF block is a gzip member whose extra field holds a `BC`
 * subfield with the block size minus one (SAM spec, section 4.1:
 * https://samtools.github.io/hts-specs/SAMv1.pdf).
 */
export function bgzfBlockSize(bytes: Uint8Array, at: number): number | undefined {
  const byte = (i: number) => bytes[at + i] ?? -1;
  const FEXTRA = 4;
  if (byte(0) !== 0x1f || byte(1) !== 0x8b || byte(2) !== 8 || (byte(3) & FEXTRA) === 0) return undefined;
  const extraLength = byte(10) | (byte(11) << 8);
  for (let i = 12; i + 4 <= 12 + extraLength; ) {
    const length = byte(i + 2) | (byte(i + 3) << 8);
    if (byte(i) === 66 && byte(i + 1) === 67 && length === 2) {
      return (byte(i + 4) | (byte(i + 5) << 8)) + 1;
    }
    i += 4 + length;
  }
  return undefined;
}

/**
 * Feeds the file's decompressed bytes to `sink` in order. Progress counts
 * bytes of the file itself, so it reaches `file.size` for compressed input.
 */
export async function readFile(
  file: Blob,
  compression: Compression,
  sink: (chunk: Uint8Array) => void,
  onProgress: (bytesRead: number) => void,
  chunkBytes = CHUNK_BYTES,
): Promise<void> {
  switch (compression) {
    case 'none':
      for (let offset = 0; offset < file.size; offset += chunkBytes) {
        const end = Math.min(offset + chunkBytes, file.size);
        sink(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
        onProgress(end);
      }
      return;
    case 'gzip':
      return readGzip(file, sink, onProgress);
    case 'bgzf':
      return readBgzf(file, sink, onProgress, chunkBytes);
  }
}

async function readGzip(file: Blob, sink: (chunk: Uint8Array) => void, onProgress: (n: number) => void) {
  let compressedRead = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      compressedRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const reader = file.stream().pipeThrough(counter).pipeThrough(gunzip()).getReader();
  for (;;) {
    const { done, value } = await reader.read().catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not decompress the file (${detail}). If it was made by joining several gzip files, decompress it first.`,
        { cause: error },
      );
    });
    if (done) break;
    sink(value);
    onProgress(compressedRead);
  }
}

// Chrome's DecompressionStream stops with an error after the first gzip
// member, so each BGZF block gets its own stream.
async function readBgzf(
  file: Blob,
  sink: (chunk: Uint8Array) => void,
  onProgress: (n: number) => void,
  chunkBytes: number,
) {
  const queue: { inflated: Promise<Uint8Array>; end: number }[] = [];
  const drain = async (keep: number) => {
    while (queue.length > keep) {
      const next = queue.shift();
      if (!next) break;
      sink(await next.inflated);
      onProgress(next.end);
    }
  };

  let pending: Uint8Array = new Uint8Array(0);
  let pendingStart = 0;
  for (let offset = 0; offset < file.size; offset += chunkBytes) {
    const slice = new Uint8Array(await file.slice(offset, Math.min(offset + chunkBytes, file.size)).arrayBuffer());
    const bytes = concat(pending, slice);
    let at = 0;
    for (;;) {
      if (!headerComplete(bytes, at)) break;
      const size = bgzfBlockSize(bytes, at);
      if (size === undefined) throw new Error(`The file is not valid BGZF at byte ${String(pendingStart + at)}.`);
      if (at + size > bytes.length) break;
      queue.push({ inflated: inflate(bytes.subarray(at, at + size)), end: pendingStart + at + size });
      at += size;
      await drain(BGZF_IN_FLIGHT);
    }
    pending = bytes.subarray(at);
    pendingStart += at;
  }
  await drain(0);
  if (pending.length > 0) throw new Error('The file ends in the middle of a BGZF block.');
}

function headerComplete(bytes: Uint8Array, at: number): boolean {
  if (bytes.length - at < 12) return false;
  const extraLength = (bytes[at + 10] ?? 0) | ((bytes[at + 11] ?? 0) << 8);
  return bytes.length - at >= 12 + extraLength;
}

function gunzip(): ReadableWritablePair<Uint8Array, Uint8Array> {
  return new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>;
}

async function inflate(member: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([member as Uint8Array<ArrayBuffer>]).stream().pipeThrough(gunzip());
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
