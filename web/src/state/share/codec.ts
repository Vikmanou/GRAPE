export class ShareLinkError extends Error {}

/** A link that carries the whole graph: `#g=<version>.<base64url payload>` (workers/pack/payload.ts). */
export const PACKED_VERSION = 1;
const PACKED_PREFIX = '#g=';

export function packedFragment(payload: string): string {
  return `${PACKED_PREFIX}${String(PACKED_VERSION)}.${payload}`;
}

export function isPackedFragment(hash: string): boolean {
  return hash.startsWith(PACKED_PREFIX);
}

/** The payload of a packed link; throws `ShareLinkError` for another version. */
export function packedPayload(hash: string): string {
  const body = hash.slice(PACKED_PREFIX.length);
  const dot = body.indexOf('.');
  const version = Number(body.slice(0, dot));
  if (dot < 0 || version !== PACKED_VERSION) {
    throw new ShareLinkError(
      `This link was made by a ${version > PACKED_VERSION ? 'newer' : 'different'} version of GRAPE.`,
    );
  }
  return body.slice(dot + 1);
}
