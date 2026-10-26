import type { GraphRequest, GraphResponse, ParseResult } from '../protocol/graph';
import type { SequenceSource } from '../protocol/sequence';
import { expect, RpcClient } from '../rpc';

export type ProgressListener = (bytesRead: number, totalBytes: number) => void;

export class GraphClient {
  private readonly rpc = new RpcClient<GraphRequest, GraphResponse>({
    name: 'graph',
    spawn: () => new Worker(new URL('./graph.worker.ts', import.meta.url), { type: 'module', name: 'graph' }),
    isUpdate: (response) => response.type === 'progress',
  });

  async ping(): Promise<{ coreVersion: string; roundTripMs: number }> {
    const start = performance.now();
    const { coreVersion } = expect(await this.rpc.request({ type: 'ping' }), 'pong');
    return { coreVersion, roundTripMs: performance.now() - start };
  }

  async parse(file: File, onProgress?: ProgressListener): Promise<{ result: ParseResult; sequences: SequenceSource }> {
    const response = await this.rpc.request(
      { type: 'parse', file },
      {
        onUpdate: (update) => {
          if (update.type === 'progress') onProgress?.(update.bytesRead, update.totalBytes);
        },
      },
    );
    const { result, sequences } = expect(response, 'parsed');
    return { result, sequences };
  }

  cancel(): void {
    this.rpc.cancel();
  }

  terminate(): void {
    this.rpc.terminate();
  }
}
