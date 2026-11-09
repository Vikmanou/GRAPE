/** What a share link checks a file against (spec, Features 12): its size, segment count and a hash of its start. */
export interface Fingerprint {
  size: number;
  segments: number;
  /** SHA-256 of the first `HASHED_BYTES`, hex. */
  sha256: string;
}

export const HASHED_BYTES = 1 << 20;

export async function headHash(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.slice(0, HASHED_BYTES).arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function sameFile(a: Fingerprint, b: Fingerprint): boolean {
  return a.size === b.size && a.segments === b.segments && a.sha256 === b.sha256;
}
