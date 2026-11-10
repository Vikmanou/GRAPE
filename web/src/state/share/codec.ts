import { base64url, fromBase64url } from '../../workers/pack/base64url';

/** The share link's format version, first in the fragment; a link of another version is refused. */
export const SHARE_VERSION = 1;
const PREFIX = '#v=';

export class ShareLinkError extends Error {}

async function deflate(bytes: Uint8Array<ArrayBuffer>, stream: CompressionStream | DecompressionStream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}

/** `#v=<version>.<base64url of deflate-raw of the JSON>` (spec, Features 12). */
export async function encodeFragment(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const packed = await deflate(json, new CompressionStream('deflate-raw'));
  return `${PREFIX}${String(SHARE_VERSION)}.${base64url(packed)}`;
}

/** Whether a URL fragment holds a share link at all, of any version. */
export function isShareFragment(hash: string): boolean {
  return hash.startsWith(PREFIX);
}

/** The JSON a fragment carries; throws `ShareLinkError` for another version or a damaged link. */
export async function decodeFragment(hash: string): Promise<unknown> {
  const body = hash.slice(PREFIX.length);
  const dot = body.indexOf('.');
  const version = Number(body.slice(0, dot));
  if (dot < 0 || version !== SHARE_VERSION) {
    throw new ShareLinkError(
      `This link was made by a ${version > SHARE_VERSION ? 'newer' : 'different'} version of GRAPE.`,
    );
  }
  try {
    const json = await deflate(fromBase64url(body.slice(dot + 1)), new DecompressionStream('deflate-raw'));
    return JSON.parse(new TextDecoder().decode(json)) as unknown;
  } catch (error) {
    throw new ShareLinkError('This link is damaged: part of it may have been cut off.', { cause: error });
  }
}
