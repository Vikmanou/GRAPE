import type { EngineCommand, EngineEvent } from '../commands';
import type { Backend, View } from '../core/backend';
import { viewToPng } from './png';

export type ExportCommand = Extract<EngineCommand, { type: 'export-png' }>;

/** Turns the current view into files, answering each request with an `exported` event. */
export class Exporter {
  constructor(
    private readonly backend: Backend,
    private readonly view: () => View,
    private readonly emit: (event: EngineEvent) => void,
    /** After an export: offscreen draws leave the backend's per-view state on the last tile. */
    private readonly redraw: () => void,
  ) {}

  handle(command: ExportCommand): void {
    void this.run(() => viewToPng(this.backend, this.view(), command.scale, command.tilePx));
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
