import type { ErrorResponse } from '../rpc';

export interface LinkFile {
  kind: 'graph' | 'fasta';
  file: File;
}

export type PackRequest =
  /** Packs the view and the files into at most `limit` characters of base64url (pack/payload.ts). */
  | { type: 'pack-link'; id: number; view: unknown; files: LinkFile[]; limit: number }
  | { type: 'unpack-link'; id: number; payload: string };

export type PackResponse =
  /** No payload when it would not fit in `limit`. */
  | { type: 'link-packed'; id: number; payload: string | undefined }
  | { type: 'link-unpacked'; id: number; view: unknown; files: LinkFile[] }
  | ErrorResponse;
