import type { Geometry } from '../../workers/protocol/layout';
import type { EngineCommand, EngineEvent } from '../commands';
import type { Backend, SegmentData, Style, View } from '../core/backend';
import type { HitBands } from '../core/Bands';
import type { Camera } from '../core/camera';
import type { Hidden } from '../core/Visibility';
import { viewToPng } from './png';
import { type SvgLabels, viewToSvg } from './svg';

export type ExportCommand = Extract<EngineCommand, { type: 'export-png' | 'export-svg' }>;

/** What the engine's parts hold that a picture of the view needs. */
export interface ExportSources {
  /** The view as the backend draws it. */
  view(): View;
  camera(): Camera;
  style(): Style;
  selection(): Uint32Array;
  hidden(): Hidden | undefined;
  labels(): SvgLabels;
  bands(): HitBands | undefined;
  /** `x, y` per point in layout units. */
  positions(): Promise<Float32Array | undefined>;
}

/** Turns the current view into files, answering each request with an `exported` event. */
export class Exporter {
  private graph: { geometry: Geometry; segments: SegmentData; seed: number } | undefined;

  constructor(
    private readonly backend: Backend,
    private readonly sources: ExportSources,
    private readonly emit: (event: EngineEvent) => void,
    /** After an export: offscreen draws leave the backend's per-view state on the last tile. */
    private readonly redraw: () => void,
  ) {}

  setGraph(geometry: Geometry, segments: SegmentData, seed: number): void {
    this.graph = { geometry, segments, seed };
  }

  /** Mirrors `set-path-colors` and `set-gc`, which change colours after the graph arrived. */
  setSegments(patch: Partial<SegmentData>): void {
    if (this.graph) this.graph = { ...this.graph, segments: { ...this.graph.segments, ...patch } };
  }

  handle(command: ExportCommand): void {
    if (command.type === 'export-png') {
      void this.run(() => viewToPng(this.backend, this.sources.view(), command.scale, command.tilePx));
    } else {
      void this.run(() => this.svg());
    }
  }

  private async svg(): Promise<Blob> {
    const { graph, sources } = this;
    const positions = await sources.positions();
    if (!graph || !positions) throw new Error('the graph has no layout yet');
    const { width, height } = sources.view();
    const { x, y, zoom } = sources.camera();
    return viewToSvg({
      ...graph,
      positions,
      style: sources.style(),
      view: { x, y, zoom, width, height },
      selection: sources.selection(),
      hidden: sources.hidden(),
      labels: sources.labels(),
      bands: sources.bands(),
    });
  }

  private async run(make: () => Promise<Blob>): Promise<void> {
    let result: { blob: Blob } | { error: string };
    try {
      result = { blob: await make() };
    } catch (error) {
      result = { error: error instanceof Error ? error.message : String(error) };
    }
    this.emit({ type: 'exported', result });
    this.redraw();
  }
}
