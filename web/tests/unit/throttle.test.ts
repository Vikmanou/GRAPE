import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '../../src/engine/core/throttle';

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at most once per interval and once after the last request', () => {
    const run = vi.fn();
    const t = throttle(run, 100);
    t.request();
    t.request();
    vi.advanceTimersByTime(0);
    expect(run).toHaveBeenCalledTimes(1);
    t.request();
    vi.advanceTimersByTime(50);
    expect(run).toHaveBeenCalledTimes(1);
    t.request();
    vi.advanceTimersByTime(60);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('cancels a pending run', () => {
    const run = vi.fn();
    const t = throttle(run, 100);
    t.request();
    t.cancel();
    vi.advanceTimersByTime(200);
    expect(run).not.toHaveBeenCalled();
  });
});
