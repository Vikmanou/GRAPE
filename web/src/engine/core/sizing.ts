export interface PixelSize {
  width: number;
  height: number;
}

/** The canvas size in device pixels for a resize entry, capped at `max`. */
export function canvasSize(entry: ResizeObserverEntry, dpr: number, max: number): PixelSize {
  // `devicePixelContentBoxSize` is undefined, not empty, in Safari.
  const box = (entry.devicePixelContentBoxSize as ResizeObserverSize[] | undefined)?.[0];
  const width = box ? box.inlineSize : Math.round(entry.contentRect.width * dpr);
  const height = box ? box.blockSize : Math.round(entry.contentRect.height * dpr);
  return { width: Math.max(1, Math.min(width, max)), height: Math.max(1, Math.min(height, max)) };
}

/** Reports each size change of `host`; the returned observer is disconnected on destroy. */
export function observeSize(host: HTMLElement, onEntry: (entry: ResizeObserverEntry) => void): ResizeObserver {
  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) onEntry(entry);
  });
  try {
    observer.observe(host, { box: 'device-pixel-content-box' });
  } catch {
    // Safari rejects this box type; the CSS size × DPR is used instead.
    observer.observe(host);
  }
  return observer;
}
