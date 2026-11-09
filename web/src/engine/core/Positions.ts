import type { PositionGrid } from '../../workers/protocol/layout';
import type { Backend, Origin } from './backend';
import { boundsOf, type Camera } from './camera';
import type { Framing } from './Framing';

/**
 * Positions are re-uploaded relative to the camera once it is this many
 * pixels from the upload origin, keeping shader maths within f32 precision.
 */
const REBASE_PIXELS = 1e5;

/**
 * Where the backend's positions come from and the origin they are drawn
 * relative to: the backend's own layout, or positions run elsewhere.
 */
export class Positions {
  private positions: Float32Array | undefined;
  private grid: PositionGrid | undefined;
  /** Positions from the worker settled once: like the GPU layout's packing, the bounds stay as they were. */
  private settled = false;
  origin: Origin = { x: 0, y: 0 };

  constructor(
    private readonly backend: Backend,
    private readonly framing: Framing,
  ) {}

  get cpuBytes(): number {
    return this.positions?.byteLength ?? 0;
  }

  reset(): void {
    this.positions = undefined;
    this.grid = undefined;
    this.settled = false;
  }

  /** The backend's layout takes over. */
  dropCpu(): void {
    this.positions = undefined;
  }

  /** `x, y` per point in layout units, from a layout run elsewhere. */
  set(positions: Float32Array, grid: PositionGrid | undefined, done: boolean): void {
    this.positions = positions;
    this.grid = grid;
    if (!this.settled) this.framing.setBounds(boundsOf(positions));
    this.settled ||= done;
    this.upload();
  }

  farFrom(camera: Camera): boolean {
    return Math.hypot(camera.x - this.origin.x, camera.y - this.origin.y) * camera.zoom > REBASE_PIXELS;
  }

  /** `x, y` per point as drawn, in layout units. */
  async read(): Promise<Float32Array<ArrayBuffer> | undefined> {
    return (await this.backend.layout.readPositions()) ?? this.positions?.slice();
  }

  /** Writes the positions relative to an origin at the camera. */
  upload(): void {
    const { camera } = this.framing;
    const origin = { x: Math.round(camera.x), y: Math.round(camera.y) };
    this.origin = origin;
    const layout = this.backend.layout;
    if (layout.active) {
      layout.present(origin);
      return;
    }
    const positions = this.positions;
    if (!positions) return;
    const relative = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 2) {
      relative[i] = (positions[i] ?? 0) - origin.x;
      relative[i + 1] = (positions[i + 1] ?? 0) - origin.y;
    }
    const grid = this.grid;
    this.backend.setPositions(relative, grid && { ...grid, minX: grid.minX - origin.x, minY: grid.minY - origin.y });
  }
}
