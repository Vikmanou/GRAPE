const STATS_INTERVAL_MS = 1000;
/** Frames further apart than this are not part of continuous drawing. */
const CONTINUOUS_GAP_MS = 50;

export interface FrameStats {
  /**
   * Frames the GPU can keep up with: animation frames per second, or fewer
   * when each draw takes the GPU longer than a frame.
   */
  fps: number;
  /** Main thread time per frame. */
  cpuMs: number;
  /** GPU time per draw, or 0 where the adapter does not report it. */
  gpuMs: number;
}

/**
 * Frame rate over back-to-back frames only: a frame drawn for an occasional
 * layout update is not part of a frame rate.
 */
export class FrameCounter {
  private last = 0;
  private time = 0;
  private frames = 0;
  private cpuMs = 0;

  /** Returns stats once a second of continuous drawing has been recorded. */
  record(now: number, cpuMs: number, gpuMs: number): FrameStats | undefined {
    const gap = now - this.last;
    this.last = now;
    if (gap > CONTINUOUS_GAP_MS) return undefined;
    this.time += gap;
    this.frames++;
    this.cpuMs += cpuMs;
    if (this.time < STATS_INTERVAL_MS) return undefined;
    const fps = (this.frames * 1000) / this.time;
    const stats = { fps: gpuMs > 0 ? Math.min(fps, 1000 / gpuMs) : fps, cpuMs: this.cpuMs / this.frames, gpuMs };
    this.time = 0;
    this.frames = 0;
    this.cpuMs = 0;
    return stats;
  }
}
