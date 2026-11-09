// Session files (.grape.json.gz): gzipped JSON holding a shared view and
// every point's position, so a layout comes back exactly on any machine or
// backend. Read and written in the graph worker: the positions of a large
// graph make a JSON string too long to handle on the main thread.

export const SESSION_VERSION = 1;
/** Bytes per base64 piece: a multiple of 3, so pieces join without padding. */
const PIECE = 3 * 0x4000;

export interface Session {
  /** Checked by the store as a share link's state is. */
  view: unknown;
  /** `x, y` per point, in layout units. */
  positions: Float32Array<ArrayBuffer>;
}

function toBase64(bytes: Uint8Array): string[] {
  const pieces: string[] = [];
  for (let i = 0; i < bytes.length; i += PIECE) {
    pieces.push(btoa(String.fromCharCode(...bytes.subarray(i, Math.min(i + PIECE, bytes.length)))));
  }
  return pieces;
}

function fromBase64(text: string, out: Uint8Array): number {
  const binary = atob(text);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return binary.length;
}

/** Float32 positions are stored little-endian, as every browser's typed arrays already are. */
export async function writeSession(view: unknown, positions: Float32Array<ArrayBuffer>): Promise<Blob> {
  const head = JSON.stringify({ grape: 'session', version: SESSION_VERSION, view }).slice(0, -1);
  const points = positions.length / 2;
  const parts = [
    head,
    `,"positions":{"encoding":"float32le-base64","points":${String(points)},"data":"`,
    ...toBase64(new Uint8Array(positions.buffer, positions.byteOffset, positions.byteLength)),
    '"}}',
  ];
  const gzipped = new Blob(parts).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(gzipped).blob();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Plain or gzipped; throws with a message for anything that is not a session file of this version. */
export async function readSession(file: Blob): Promise<Session> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const stream = gzipped ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream();
  let parsed: unknown;
  try {
    parsed = JSON.parse(await new Response(stream).text());
  } catch (error) {
    throw new Error('This is not a GRAPE session file: it is not readable JSON.', { cause: error });
  }
  if (!isRecord(parsed) || parsed.grape !== 'session') throw new Error('This is not a GRAPE session file.');
  if (parsed.version !== SESSION_VERSION) {
    throw new Error(
      `This session was saved by a ${Number(parsed.version) > SESSION_VERSION ? 'newer' : 'different'} version of GRAPE.`,
    );
  }
  const p = parsed.positions;
  if (!isRecord(p) || p.encoding !== 'float32le-base64' || typeof p.data !== 'string' || typeof p.points !== 'number') {
    throw new Error('This session file has no positions.');
  }
  const bytes = new Uint8Array(Math.max(0, p.points) * 8);
  let read: number;
  try {
    read = fromBase64(p.data, bytes);
  } catch (error) {
    throw new Error('The positions in this session file are damaged.', { cause: error });
  }
  if (read !== bytes.length) throw new Error('The positions in this session file are damaged.');
  return { view: parsed.view, positions: new Float32Array(bytes.buffer) };
}
