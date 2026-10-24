const DASH = '–';

export function formatCount(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : DASH;
}

function scaled(n: number, units: readonly string[], base: number): string {
  if (!Number.isFinite(n)) return DASH;
  let value = n;
  let unit = 0;
  while (Math.abs(value) >= base && unit < units.length - 1) {
    value /= base;
    unit++;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit] ?? ''}`;
}

export function formatBases(n: number): string {
  return scaled(n, ['bp', 'kb', 'Mb', 'Gb'], 1000);
}

export function formatBytes(n: number): string {
  return scaled(n, ['B', 'KB', 'MB', 'GB'], 1024);
}

export function formatPercent(fraction: number): string {
  return Number.isFinite(fraction) ? `${(fraction * 100).toFixed(1)}%` : DASH;
}

export function formatDepth(depth: number): string {
  return Number.isFinite(depth) ? `${depth.toFixed(1)}×` : DASH;
}
