import { DEFAULT_LABEL_OPTIONS, type LabelOptions } from '../engine/text/Labels';
import type { LabelContent } from '../workers/protocol/graph';
import type { Context } from './store';

export interface LabelSettings extends LabelOptions {
  show: boolean;
  content: LabelContent;
}

export const DEFAULT_LABELS: LabelSettings = {
  ...DEFAULT_LABEL_OPTIONS,
  show: false,
  content: { custom: false, name: true, length: false, depth: false },
};

export interface LabelSlice {
  labels: LabelSettings;
  /** How many labels show. */
  labelCount: number;
  setLabels: (patch: Partial<LabelSettings>) => void;
  /** Sends the engine the label sizes for the loaded graph and the chosen content. */
  refreshLabels: () => void;
  /** Answers the engine's `labels-needed`. */
  fetchLabelText: (generation: number, segments: Uint32Array<ArrayBuffer>) => void;
}

const anyLine = (c: LabelContent) => c.custom || c.name || c.length || c.depth;

export function createLabelSlice(ctx: Context): LabelSlice {
  const { set, get, services } = ctx;
  /** Numbers each request for sizes, so answers for older ones are dropped. */
  let generation = 0;

  return {
    labels: DEFAULT_LABELS,
    labelCount: 0,

    setLabels(patch) {
      const before = get().labels;
      const labels = { ...before, ...patch };
      set({ labels });
      const { max, minRibbonPx, fontPx } = labels;
      ctx.bridge.send({ type: 'set-label-options', options: { max, minRibbonPx, fontPx } });
      if (labels.show !== before.show || labels.content !== before.content) get().refreshLabels();
    },

    refreshLabels() {
      const { labels, load } = get();
      const current = ++generation;
      if (!labels.show || !anyLine(labels.content) || load.state !== 'loaded') {
        ctx.bridge.send({ type: 'set-label-sizes', generation: current, sizes: undefined });
        set({ labelCount: 0 });
        return;
      }
      services.graph.labelSizes(labels.content).then(
        (sizes) => {
          if (current === generation) ctx.bridge.send({ type: 'set-label-sizes', generation: current, sizes });
        },
        (error: unknown) => {
          get().toast('Labels could not be made', error instanceof Error ? error.message : String(error));
        },
      );
    },

    fetchLabelText(asked, segments) {
      const content = get().labels.content;
      services.graph.labelText(segments, content).then(
        (texts) => {
          ctx.bridge.send({ type: 'set-label-text', generation: asked, segments, texts });
        },
        () => undefined,
      );
    },
  };
}
