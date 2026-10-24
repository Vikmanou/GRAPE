export const CHUNK_BYTES = 4 * 1024 * 1024;

export async function isGzip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/**
 * Feeds the file's (decompressed) bytes to `sink` in order. Progress counts
 * bytes of the file itself, so it reaches `file.size` for gzip input too.
 */
export async function readFile(
  file: Blob,
  gzip: boolean,
  sink: (chunk: Uint8Array) => void,
  onProgress: (bytesRead: number) => void,
): Promise<void> {
  if (!gzip) {
    for (let offset = 0; offset < file.size; offset += CHUNK_BYTES) {
      const end = Math.min(offset + CHUNK_BYTES, file.size);
      sink(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
      onProgress(end);
    }
    return;
  }
  let compressedRead = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      compressedRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  const stream = file
    .stream()
    .pipeThrough(counter)
    .pipeThrough(new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>);
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    sink(value);
    onProgress(compressedRead);
  }
}
