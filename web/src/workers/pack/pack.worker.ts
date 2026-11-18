// Packs and unpacks share links that carry the whole graph. Started for one
// request and stopped after it (PackClient), so the graph worker keeps
// answering while a large graph packs, and the coder's tables are freed.

import init, { packFile, unpackFile } from '../../wasm/pkg/gfa_wasm';
import wasmUrl from '../../wasm/pkg/gfa_wasm_bg.wasm?url';
import { detectCompression, readFile } from '../graph/readFile';
import { plain } from '../shared/plain';
import type { LinkFile, PackRequest, PackResponse } from '../protocol/pack';
import { base64url, fromBase64url } from '../shared/base64url';
import { joinParts, type Part, splitParts } from './payload';

const ready = init({ module_or_path: wasmUrl });
/** gfa-core's `MAX_UNPACKED`: past it the recipient could not open the link anyway. */
const MAX_INPUT = 512 * 1024 * 1024;
/** Room for a part's kind, name and lengths. */
const HEAD = 300;

function post(message: PackResponse): void {
  self.postMessage(message);
}

/** The file as the parser sees it, gzip undone; undefined past `MAX_INPUT`. */
async function contents(file: File): Promise<Uint8Array | undefined> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  await readFile(
    file,
    await detectCompression(file),
    (chunk) => {
      total += chunk.length;
      if (total <= MAX_INPUT) chunks.push(chunk);
    },
    () => undefined,
  );
  if (total > MAX_INPUT) return undefined;
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.length;
  }
  return bytes;
}

async function pack(view: unknown, files: LinkFile[], limit: number): Promise<string | undefined> {
  await ready;
  let budget = Math.floor((limit * 3) / 4);
  const parts: Part[] = [];
  const add = (kind: Part['kind'], name: string, bytes: Uint8Array): boolean => {
    const packed = packFile(bytes, Math.max(0, budget - HEAD));
    if (!packed) return false;
    budget -= packed.length + HEAD;
    parts.push({ kind, name, bytes: packed });
    return true;
  };
  if (!add('view', '', new TextEncoder().encode(JSON.stringify(view)))) return undefined;
  for (const { kind, file } of files) {
    const bytes = await contents(file);
    if (!bytes || !add(kind, file.name.replace(/\.b?gz$/i, ''), bytes)) return undefined;
  }
  const payload = base64url(joinParts(parts));
  return payload.length <= limit ? payload : undefined;
}

async function unpack(payload: string): Promise<{ view: unknown; files: LinkFile[] }> {
  await ready;
  let parts: Part[];
  try {
    parts = splitParts(fromBase64url(payload));
  } catch (error) {
    throw new Error('This link is damaged: part of it may have been cut off.', { cause: error });
  }
  let view: unknown;
  const files: LinkFile[] = [];
  for (const part of parts) {
    const bytes = plain(unpackFile(part.bytes));
    if (part.kind === 'view') view = JSON.parse(new TextDecoder().decode(bytes));
    else files.push({ kind: part.kind, file: new File([bytes], part.name) });
  }
  if (view === undefined || !files.some((f) => f.kind === 'graph')) {
    throw new Error('This link is damaged: it holds no graph.');
  }
  return { view, files };
}

async function handle(request: PackRequest): Promise<void> {
  const { id } = request;
  switch (request.type) {
    case 'pack-link':
      post({ type: 'link-packed', id, payload: await pack(request.view, request.files, request.limit) });
      return;
    case 'unpack-link':
      post({ type: 'link-unpacked', id, ...(await unpack(request.payload)) });
      return;
  }
}

self.addEventListener('message', (event: MessageEvent<PackRequest>) => {
  const request = event.data;
  handle(request).catch((error: unknown) => {
    post({ type: 'error', id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
});
