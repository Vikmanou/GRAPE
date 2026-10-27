import type { LevelRecord } from '../../core/backend';

/** Where a layout's time goes, level by level, for the benchmarks. */
export class LevelProfile {
  private readonly records: LevelRecord[] = [];
  private started = 0;

  enter(level: number, nodes: number, now: number): void {
    this.leave(now);
    this.started = now;
    this.records.push({ level, nodes, iterations: 0, gpuMs: 0, wallMs: 0 });
  }

  ran(level: number, iterations: number): void {
    const record = this.find(level);
    if (record) record.iterations += iterations;
  }

  /** GPU time arrives after the batch ran, possibly once the next level began. */
  timed(level: number, ms: number): void {
    const record = this.find(level);
    if (record) record.gpuMs += ms;
  }

  /** Closes the running level's wall time. */
  leave(now: number): void {
    const last = this.records.at(-1);
    if (last && last.wallMs === 0) last.wallMs = now - this.started;
  }

  get levels(): LevelRecord[] {
    return this.records.map((r) => ({ ...r }));
  }

  private find(level: number): LevelRecord | undefined {
    return this.records.findLast((r) => r.level === level);
  }
}
