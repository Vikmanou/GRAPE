import { describe, expect, it } from 'vitest';
import { formatBases, formatBytes, formatCount, formatDepth, formatPercent, formatSeconds } from '../../src/ui/format';

describe('format', () => {
  it('scales bases', () => {
    expect(formatBases(12)).toBe('12 bp');
    expect(formatBases(1234)).toBe('1.2 kb');
    expect(formatBases(4_641_652)).toBe('4.6 Mb');
    expect(formatBases(123_456_789)).toBe('123 Mb');
    expect(formatBases(3.2e9)).toBe('3.2 Gb');
  });

  it('shows milliseconds below a second', () => {
    expect(formatSeconds(340.4)).toBe('340 ms');
    expect(formatSeconds(1234)).toBe('1.2 s');
  });

  it('scales bytes in binary units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
  });

  it('shows a dash for unknown values', () => {
    expect(formatDepth(Number.NaN)).toBe('–');
    expect(formatPercent(Number.NaN)).toBe('–');
    expect(formatCount(Number.NaN)).toBe('–');
  });

  it('formats counts, depth and percentages', () => {
    expect(formatCount(1234567)).toBe('1,234,567');
    expect(formatDepth(12.666)).toBe('12.7×');
    expect(formatPercent(0.5)).toBe('50.0%');
  });
});
