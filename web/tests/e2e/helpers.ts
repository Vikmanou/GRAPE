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
