import {
  type ChainMap,
  chainTransfers,
  type FastaRecords,
  type GfaRecords,
  type SequenceRequest,
  type SequenceResponse,
  type SequenceSource,
  sourceTransfers,
} from '../protocol/sequence';
import { expect, RpcClient, type WorkerMemory } from '../rpc';

export interface Preview {
  length: number;
  head: string;
  tail: string;
  missing: boolean;
}

export class SequenceClient {
  private readonly rpc = new RpcClient<SequenceRequest, SequenceResponse>({
    name: 'sequence',
    spawn: () => new Worker(new URL('./sequence.worker.ts', import.meta.url), { type: 'module', name: 'sequence' }),
    isUpdate: () => false,
  });

  async load(source: SequenceSource): Promise<void> {
    expect(await this.rpc.request({ type: 'load', source }, { transfer: sourceTransfers(source) }), 'loaded');
  }

  async memory(): Promise<WorkerMemory> {
    return expect(await this.rpc.request({ type: 'memory' }), 'memory').memory;
  }

  async preview(segment: number, bases: number): Promise<Preview> {
    const { length, head, tail, missing } = expect(
      await this.rpc.request({ type: 'preview', segment, bases }),
      'preview',
    );
    return { length, head, tail, missing };
  }

  async sequence(segments: Uint32Array<ArrayBuffer>): Promise<string> {
    return expect(await this.rpc.request({ type: 'sequence', segments }), 'sequence').text;
  }

  async rawLine(segment: number): Promise<{ text: string; elided: number } | undefined> {
    return expect(await this.rpc.request({ type: 'raw-line', segment }), 'raw-line').line;
  }

  async fasta(records: FastaRecords): Promise<Blob> {
    return expect(await this.rpc.request({ type: 'fasta', records }), 'fasta').blob;
  }

  async setChains(map: ChainMap | undefined): Promise<void> {
    const transfer = map ? chainTransfers(map) : [];
    expect(await this.rpc.request({ type: 'chains', map }, { transfer }), 'loaded');
  }

  async gfa(records: GfaRecords): Promise<Blob> {
    return expect(await this.rpc.request({ type: 'gfa', records }, { transfer: [records.links.buffer] }), 'gfa').blob;
  }
}
