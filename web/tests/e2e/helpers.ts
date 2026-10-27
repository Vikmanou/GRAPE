// Shared by the end-to-end tests.

import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

export const repo = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url));

export function failOnPageError(page: Page): void {
  page.on('pageerror', (error) => {
    throw error;
  });
}

/** Skips the test unless the page picked WebGPU, which needs `npm run check:headed`. */
export async function skipWithoutWebGpu(page: Page): Promise<void> {
  // Detection can finish after the core is ready, especially on a busy GPU.
  const status = page.getByTestId('status-renderer');
  await expect(status).not.toHaveAttribute('data-renderer', 'detecting');
  const renderer = await status.getAttribute('data-renderer');
  test.skip(renderer !== 'webgpu', 'needs a WebGPU adapter (npm run check:headed)');
}

export async function showTab(page: Page, tab: 'overview' | 'display' | 'find'): Promise<void> {
  await page.getByTestId(`tab-${tab}`).click();
}

export interface AppSnapshot {
  selection: { count: number; single: number | undefined };
  hovered: number | undefined;
  zoom: number | undefined;
}

/** The parts of the store the flows check, read through `window.grapeTest`. */
export function appState(page: Page): Promise<AppSnapshot> {
  return page.evaluate(() => {
    type State = {
      selection: AppSnapshot['selection'];
      hovered: number | undefined;
      camera: { zoom: number } | undefined;
    };
    const store = (window as unknown as { grapeTest: { store: { getState(): State } } }).grapeTest.store;
    const { selection, hovered, camera } = store.getState();
    return { selection: { count: selection.count, single: selection.single }, hovered, zoom: camera?.zoom };
  });
}

/** Opens a file and waits for its layout to settle. Needs WebGPU. */
export async function openSettled(page: Page, path: string): Promise<void> {
  failOnPageError(page);
  await page.setViewportSize({ width: 1200, height: 750 });
  await page.goto('/');
  await expect(page.getByTestId('status-core')).toHaveAttribute('data-state', 'ready');
  await skipWithoutWebGpu(page);
  await page.getByTestId('open-input').setInputFiles(path);
  await expect(page.getByTestId('status-layout')).toHaveAttribute('data-state', 'done', { timeout: 120_000 });
}

/**
 * Page coordinates of up to `count` different segments, found by picking a
 * grid of the canvas pixels no panel covers.
 */
export async function segmentsOnScreen(page: Page, count: number): Promise<Map<number, { x: number; y: number }>> {
  const box = await page.getByTestId('engine-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const found = await page.evaluate(async (count) => {
    type Picked = { type: string; x?: number; y?: number; segment?: number };
    type Hooks = { send(command: unknown): void; on(listener: (event: Picked) => void): () => void };
    const hooks = (window as unknown as { grapeTest: Hooks }).grapeTest;
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const pick = (x: number, y: number) =>
      new Promise<number | undefined>((resolve) => {
        const off = hooks.on((event) => {
          if (event.type === 'picked' && event.x === x && event.y === y) {
            off();
            resolve(event.segment);
          }
        });
        hooks.send({ type: 'pick', x, y });
      });
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const step = Math.round(6 * scale);
    const rect = canvas.getBoundingClientRect();
    // Only pixels the pointer can reach: panels cover parts of the canvas.
    const reachable = (x: number, y: number) =>
      document.elementFromPoint(rect.left + x / scale, rect.top + y / scale) === canvas;
    const pixels: [number, number][] = [];
    for (let y = step; y < canvas.height; y += step) {
      for (let x = step; x < canvas.width; x += step) if (reachable(x, y)) pixels.push([x, y]);
    }
    const out: [number, number, number][] = [];
    for (let i = 0; i < pixels.length && out.length < count; i += 256) {
      const batch = pixels.slice(i, i + 256);
      const picked = await Promise.all(batch.map(([x, y]) => pick(x, y)));
      for (const [k, segment] of picked.entries()) {
        const [x = 0, y = 0] = batch[k] ?? [];
        if (segment !== undefined && out.length < count && !out.some(([s]) => s === segment)) {
          out.push([segment, x / scale, y / scale]);
        }
      }
    }
    return out;
  }, count);
  return new Map(found.map(([segment, x, y]) => [segment, { x: box.x + x, y: box.y + y }]));
}

/**
 * The colour of the ribbon at page coordinates `x, y`: of the pixels around
 * it, the one least like the background, so an antialiased edge does not count.
 */
export async function ribbonColor(page: Page, x: number, y: number): Promise<[number, number, number]> {
  const r = 3;
  const png = await page.screenshot({
    clip: { x: Math.floor(x) - r, y: Math.floor(y) - r, width: 2 * r + 1, height: 2 * r + 1 },
  });
  return page.evaluate(async (data) => {
    const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no 2d context');
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, image.width, image.height).data;
    const background = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) ?? [];
    let best: [number, number, number] = [0, 0, 0];
    let farthest = -1;
    for (let i = 0; i < pixels.length; i += 4) {
      const rgb: [number, number, number] = [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0];
      const distance = rgb.reduce((sum, v, k) => sum + Math.abs(v - (background[k] ?? 0)), 0);
      if (distance > farthest) [best, farthest] = [rgb, distance];
    }
    return best;
  }, png.toString('base64'));
}

/** Within a few levels per channel, for colours read off antialiased ribbons. */
export function near(got: number[], want: number[], tolerance = 24): boolean {
  return got.every((v, i) => Math.abs(v - (want[i] ?? 0)) <= tolerance);
}

/** Calls an action of the store, for flows that set state the UI reaches in several steps. */
export async function storeAction(page: Page, action: string, ...args: unknown[]): Promise<void> {
  await page.evaluate(
    ([name, rest]) => {
      type Store = { getState(): Record<string, (...a: unknown[]) => void> };
      const store = (window as unknown as { grapeTest: { store: Store } }).grapeTest.store;
      store.getState()[name]?.(...rest);
    },
    [action, args] as const,
  );
}
