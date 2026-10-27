import type { GraphRequest, GraphResponse, ParseResult, SegmentInfo, SelectionSummary } from '../protocol/graph';
import type { FastaRecords, SequenceSource } from '../protocol/sequence';
import type { FindQuery } from './findQuery';
import { expect, RpcClient, type WorkerMemory } from '../rpc';

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

  async info(segment: number): Promise<SegmentInfo | undefined> {
    return expect(await this.rpc.request({ type: 'info', segment }), 'info').info;
  }

  async summary(bits: Uint32Array<ArrayBuffer>): Promise<SelectionSummary> {
    return expect(await this.rpc.request({ type: 'summary', bits }), 'summary').summary;
  }

  async find(query: FindQuery): Promise<{ segments: Uint32Array<ArrayBuffer>; missing: string[] }> {
    const { segments, missing } = expect(await this.rpc.request({ type: 'find', query }), 'found');
    return { segments, missing };
  }

  async exportRecords(segments: Uint32Array<ArrayBuffer>): Promise<FastaRecords> {
    return expect(await this.rpc.request({ type: 'export', segments }), 'export').records;
  }

  async memory(): Promise<WorkerMemory> {
    return expect(await this.rpc.request({ type: 'memory' }), 'memory').memory;
  }

  cancel(): void {
    this.rpc.cancel();
  }

  terminate(): void {
    this.rpc.terminate();
  }
}
