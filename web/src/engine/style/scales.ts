export type Scale = 'linear' | 'log';

export interface ColorRange {
  scale: Scale;
  min: number;
  max: number;
}

/** Log scales treat zero and below as this. */
const LOG_FLOOR = 1e-30;

function along(value: number, scale: Scale): number {
  return scale === 'log' ? Math.log(Math.max(value, LOG_FLOOR)) : value;
}

/** Where `value` falls in the range, clamped to 0 to 1; NaN when the value is unknown. */
export function rangeFraction(value: number, { scale, min, max }: ColorRange): number {
  if (Number.isNaN(value)) return NaN;
  const lo = along(min, scale);
  const span = along(max, scale) - lo;
  if (!(span > 0)) return 0;
  return Math.min(1, Math.max(0, (along(value, scale) - lo) / span));
}
