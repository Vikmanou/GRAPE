import type { LinkFile, PackRequest, PackResponse } from '../protocol/pack';
import { expect, RpcClient } from '../shared/rpc';

/** One worker per request, stopped when it answers or is cancelled. */
export class PackClient {
  private rpc: RpcClient<PackRequest, PackResponse> | undefined;

  /** The base64url payload, or undefined if it would pass `limit` characters. */
  async pack(view: unknown, files: LinkFile[], limit: number): Promise<string | undefined> {
    try {
      return expect(await this.start().request({ type: 'pack-link', view, files, limit }), 'link-packed').payload;
    } finally {
      this.cancel();
    }
  }

  async unpack(payload: string): Promise<{ view: unknown; files: LinkFile[] }> {
    try {
      const { view, files } = expect(await this.start().request({ type: 'unpack-link', payload }), 'link-unpacked');
      return { view, files };
    } finally {
      this.cancel();
    }
  }

  /** Rejects a request in flight with `WorkerTerminatedError`. */
  cancel(): void {
    this.rpc?.terminate();
    this.rpc = undefined;
  }

  private start(): RpcClient<PackRequest, PackResponse> {
    this.cancel();
    this.rpc = new RpcClient({
      name: 'pack',
      spawn: () => new Worker(new URL('./pack.worker.ts', import.meta.url), { type: 'module', name: 'pack' }),
      isUpdate: () => false,
    });
    return this.rpc;
  }
}
