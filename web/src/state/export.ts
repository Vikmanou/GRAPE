import { setBits } from './bits';
import type { Context } from './store';

export type ExportScope = 'selection' | 'visible';

export interface ExportSlice {
  /** FASTA of the selected or the shown segments, as Bandage saves selected sequences. */
  exportFasta: (scope: ExportScope) => Promise<Blob>;
  /** GFA of the selected or the shown segments and the links among them, as Bandage saves the visible graph. */
  exportGfa: (scope: ExportScope) => Promise<Blob>;
}

export function createExportSlice(ctx: Context): ExportSlice {
  const { get, services } = ctx;

  async function bits(scope: ExportScope): Promise<Uint32Array<ArrayBuffer>> {
    if (scope === 'selection') return get().selection.bits.slice();
    return (await ctx.bridge.ask({ type: 'read-visible' }, 'visible')).bits;
  }

  return {
    async exportFasta(scope) {
      const records = await services.graph.exportRecords(setBits(await bits(scope)));
      return services.sequence.fasta(records);
    },

    async exportGfa(scope) {
      return services.sequence.gfa(await services.graph.gfa(await bits(scope)));
    },
  };
}
