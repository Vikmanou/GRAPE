/** Keeps only the fields of `fallback` whose stored value has the same type: for data the app did not write itself. */
export function sameShape<T extends object>(fallback: T, stored: unknown): T {
  if (typeof stored !== 'object' || stored === null) return fallback;
  const out: Record<string, unknown> = { ...(fallback as Record<string, unknown>) };
  for (const [key, value] of Object.entries(fallback) as [string, unknown][]) {
    const saved = (stored as Record<string, unknown>)[key];
    if (typeof value === 'object' && value !== null) out[key] = sameShape(value, saved);
    else if (typeof saved === typeof value) out[key] = saved;
  }
  return out as T;
}
